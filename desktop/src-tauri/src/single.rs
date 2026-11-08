//! One copy of the app per user: launching it again raises the copy that is
//! already running.
//!
//! With "keep running in the tray" on (the default), closing the window only
//! parks the process. Double-clicking the icon afterwards used to start a
//! **second** process — a second loopback proxy on a second port, a second tray
//! icon, and an empty window that had forgotten the page, the SSE connections
//! and the session the parked one was still holding. A launch has to land on the
//! copy that is already there; that is what "restore the previous app" means.
//!
//! No platform API and no new dependency: the first process binds a loopback
//! port and writes `{pid, port, token}` to `app_config_dir/instance.json`; a later
//! launch reads that file, asks the owner of the port to come forward, and exits
//! without starting anything.
//!
//! **A record nobody answers is stale** — that single rule covers both a clean
//! quit and a crash, which is why the record is *not* deleted on exit. A leftover
//! costs one refused connection at the next launch, and there is no "did the last
//! run end properly?" flag to get wrong.
//!
//! The listener does exactly one thing (raise the window) and only for a caller
//! that presents the token from the record, so a stray local program cannot pop
//! the window on its own.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rand::RngCore;
use serde::{Deserialize, Serialize};

/// The first word on the wire. It keeps a port scan from looking like an
/// agentbuddy launch and pins the rest of the line to one shape.
pub const PROTOCOL: &str = "agentbuddy/1";

/// The only action there is: bring the parked window forward. It is a word
/// rather than an implicit ping so a future action ("open /threads/42") does not
/// have to change the protocol's shape.
const ACTION_SHOW: &str = "show";

/// What the owner answers when it accepted the request.
const REPLY_OK: &str = "ok";

/// The file that names the running copy, inside the app config directory.
const RECORD_FILE: &str = "instance.json";

/// The longest request or reply line that is read. Everything this protocol says
/// fits in a few dozen bytes; the bound is what keeps a rogue client from making
/// the process allocate without limit.
const LINE_LIMIT: u64 = 256;

/// How long one handshake may take. Short on purpose: the answer is a single line
/// from a process on this machine, and a launch must not sit waiting on a
/// leftover that will never reply.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(1);

/// How long a launch waits before retrying a claim that could not be settled —
/// a record that is not readable yet, or a record file that could not be created
/// because another launch holds it.
const RETRY: Duration = Duration::from_millis(150);

/// How many times the claim is attempted before giving up on arbitration and
/// simply starting. Losing the race costs a duplicate window — the behaviour this
/// module replaces — and never a failed launch.
const ATTEMPTS: u32 = 3;

/// What a launch learned about this machine.
pub enum Claim {
    /// Another copy answered and has been asked to come forward. This process has
    /// nothing left to do: no window, no proxy, no config.
    AlreadyRunning,
    /// This process owns the app. The instance is handed back so `serve` can wire
    /// the window to it before a second launch can arrive.
    Primary(Instance),
}

/// The record this process published, and the listener a later launch will talk
/// to. Dropping it without `serve` closes the port; the record on disk then looks
/// stale to the next launch, which is the correct reading.
pub struct Instance {
    listener: Option<TcpListener>,
    token: String,
}

impl Instance {
    /// An instance that cannot be reached: the config directory is not writable,
    /// or three claims in a row lost a race. The app still starts — being
    /// unarbitrated is the old behaviour, refusing to start is not an option.
    fn detached() -> Self {
        Instance { listener: None, token: String::new() }
    }

    /// Answers handshakes on a background thread, calling `raise` for each caller
    /// that proves it is a launch of this app. `raise` runs off the UI thread, so
    /// it must only use thread-safe Tauri calls (show / unminimize / set_focus).
    pub fn serve(mut self, raise: impl Fn() + Send + 'static) {
        let Some(listener) = self.listener.take() else {
            return;
        };
        let token = self.token;
        let spawned = std::thread::Builder::new()
            .name("agentbuddy-instance".to_string())
            .spawn(move || loop {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if accepts(stream, &token) {
                            raise();
                        }
                    }
                    // A listener error is almost always one aborted connection
                    // (ECONNABORTED / EMFILE). Pausing keeps a persistent error
                    // from turning into a busy loop.
                    Err(_) => std::thread::sleep(RETRY),
                }
            });
        if let Err(err) = spawned {
            eprintln!("agentbuddy desktop: cannot listen for a second launch: {err}");
        }
    }
}

/// Decides whether this launch owns the app.
///
/// `dir` is the shell's own config directory, so two OS users (and two builds
/// with different identifiers) never arbitrate against each other.
pub fn claim(dir: &Path) -> Claim {
    let path = record_path(dir);
    let mut attempt = 0;
    while attempt < ATTEMPTS {
        attempt += 1;
        if let Some(record) = read_record(&path) {
            if ask_to_show(&record) {
                return Claim::AlreadyRunning;
            }
            // Nobody answered, so the process that wrote this is gone (a crash
            // and a clean quit look identical from here). Drop the record and
            // take over rather than refusing to start.
            let _ = fs::remove_file(&path);
        } else if attempt == 1 && path.exists() {
            // Unreadable, but present: either a launch that is writing its
            // record right now or garbage from a crash. One beat tells them
            // apart; removing it immediately would let two simultaneous launches
            // both believe they are the first.
            std::thread::sleep(RETRY);
            continue;
        } else {
            let _ = fs::remove_file(&path);
        }
        if let Ok(instance) = publish(dir, &path) {
            return Claim::Primary(instance);
        }
        std::thread::sleep(RETRY);
    }
    eprintln!(
        "agentbuddy desktop: another copy could not be ruled out; starting anyway (a second window is possible)"
    );
    Claim::Primary(Instance::detached())
}

fn record_path(dir: &Path) -> PathBuf {
    dir.join(RECORD_FILE)
}

/// Binds the port, claims the record file and writes it.
///
/// `create_new` is what makes the claim atomic: two launches that start in the
/// same instant cannot both believe they own the app, because only one of them
/// can create the file. The loser gets `AlreadyExists` and retries — by then the
/// winner's record is on disk and the handshake decides.
fn publish(dir: &Path, path: &Path) -> std::io::Result<Instance> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    let token = random_hex();
    let text = serde_json::to_string(&Record { pid: std::process::id(), port, token: token.clone() })
        .map_err(std::io::Error::other)?;
    fs::create_dir_all(dir)?;

    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    // The token is not a credential, but it is this user's window: keep it to the
    // same owner as the config and the session file. Windows relies on the
    // per-user ACL of the config directory, which is why nothing is done there.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(text.as_bytes())?;
    Ok(Instance { listener: Some(listener), token })
}

/// The record on disk as far as it can be trusted, or `None`.
///
/// An empty token or port would let a caller in without proving anything, so a
/// record carrying either counts as unusable — the same as no record at all.
fn read_record(path: &Path) -> Option<Record> {
    let text = fs::read_to_string(path).ok()?;
    let record: Record = serde_json::from_str(&text).ok()?;
    if record.token.is_empty() || record.port == 0 {
        return None;
    }
    Some(record)
}

/// Asks the owner of `record` to come forward. `false` means nobody answered,
/// which is exactly what a leftover from a dead process looks like.
fn ask_to_show(record: &Record) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, record.port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, HANDSHAKE_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT));
    if stream.write_all(request_line(&record.token).as_bytes()).is_err() {
        return false;
    }
    let mut reply = String::new();
    if stream.take(LINE_LIMIT).read_to_string(&mut reply).is_err() {
        return false;
    }
    reply.trim() == REPLY_OK
}

/// Reads one request, answers it, and reports whether the caller may raise the
/// window. A refused caller is answered too: it then knows it was heard and
/// rejected instead of blocking on a timeout.
fn accepts(stream: TcpStream, token: &str) -> bool {
    let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT));
    let Ok(reader_side) = stream.try_clone() else {
        return false;
    };
    let mut line = String::new();
    let read = BufReader::new(reader_side).take(LINE_LIMIT).read_line(&mut line);
    let accepted = read.is_ok() && parse_request(&line, token) == Some(Action::Show);
    let mut stream = stream;
    let _ = stream.write_all(if accepted { "ok\n" } else { "no\n" }.as_bytes());
    accepted
}

/// What a peer asked for.
#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Show,
}

/// Reads one request line. `None` means "not addressed to us": a different
/// protocol, an action that does not exist, a line of the wrong shape, or — the
/// case that matters — a token that does not match the record.
pub fn parse_request(line: &str, token: &str) -> Option<Action> {
    let mut parts = line.trim().split(' ');
    let protocol = parts.next()?;
    let action = parts.next()?;
    let presented = parts.next()?;
    if parts.next().is_some() || protocol != PROTOCOL || presented != token {
        return None;
    }
    match action {
        ACTION_SHOW => Some(Action::Show),
        _ => None,
    }
}

fn request_line(token: &str) -> String {
    format!("{PROTOCOL} {ACTION_SHOW} {token}\n")
}

/// A random 256 bit value, hex encoded. Same shape as the proxy's token: the
/// point is that a caller has to have read the record, not that the value is a
/// secret between users.
fn random_hex() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Record {
    pid: u32,
    port: u16,
    token: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// One directory per case: the records of two cases must never meet.
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agentbuddy-single-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// Takes the app the way the first launch does, counting how often the
    /// window is asked to come forward.
    fn primary(dir: &Path) -> Arc<AtomicUsize> {
        let Claim::Primary(instance) = claim(dir) else {
            panic!("the first launch must own the app");
        };
        let raised = Arc::new(AtomicUsize::new(0));
        let counter = raised.clone();
        instance.serve(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        raised
    }

    /// Waits for the listener thread to have handled the request it was given.
    fn count_after_settle(raised: &AtomicUsize) -> usize {
        for _ in 0..100 {
            if raised.load(Ordering::SeqCst) > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        raised.load(Ordering::SeqCst)
    }

    fn stored(dir: &Path) -> Record {
        serde_json::from_str(&fs::read_to_string(record_path(dir)).expect("a record is on disk"))
            .expect("the record is the shape we wrote")
    }

    /// Sends one line and reads the answer, the way a second launch would.
    fn round_trip(port: u16, line: &str) -> String {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let mut stream =
            TcpStream::connect_timeout(&addr, HANDSHAKE_TIMEOUT).expect("the owner is listening");
        stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).unwrap();
        stream.write_all(line.as_bytes()).unwrap();
        let mut reply = String::new();
        stream.take(LINE_LIMIT).read_to_string(&mut reply).unwrap();
        reply.trim().to_string()
    }

    #[test]
    fn a_second_launch_raises_the_copy_that_is_already_running() {
        let dir = temp_dir("raise");
        let raised = primary(&dir);
        let before = stored(&dir);

        // The handoff: the second launch is told to stand down, and the first one
        // is the copy that comes forward.
        assert!(matches!(claim(&dir), Claim::AlreadyRunning));
        assert_eq!(count_after_settle(&raised), 1, "the running copy must be raised exactly once");

        // The record still names that copy: nothing was taken over.
        assert_eq!(stored(&dir), before, "a handoff must not rewrite the record");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_record_left_by_a_dead_process_is_taken_over() {
        let dir = temp_dir("stale");
        fs::create_dir_all(&dir).unwrap();
        // A port nobody listens on: bind, read it back, drop the listener.
        let port = {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            listener.local_addr().unwrap().port()
        };
        fs::write(
            record_path(&dir),
            format!(r#"{{"pid":1,"port":{port},"token":"deadbeef"}}"#),
        )
        .unwrap();

        let Claim::Primary(_instance) = claim(&dir) else {
            panic!("a stale record must not keep the app from starting");
        };
        let record = stored(&dir);
        assert_eq!(record.pid, std::process::id(), "the new launch publishes itself");
        assert_ne!(record.token, "deadbeef", "the new owner must not inherit the old token");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_record_that_cannot_be_used_is_replaced() {
        // A crash between `create_new` and the write leaves an empty file, and a
        // hand-edited one can carry no token at all. Neither may disable the
        // check for good, so both are replaced by a usable record.
        for text in ["", "{ not json", r#"{"pid":1,"port":1,"token":""}"#] {
            let dir = temp_dir("broken");
            fs::create_dir_all(&dir).unwrap();
            fs::write(record_path(&dir), text).unwrap();
            let Claim::Primary(_instance) = claim(&dir) else {
                panic!("an unusable record `{text}` must not own the app");
            };
            let record = stored(&dir);
            assert_eq!(record.pid, std::process::id());
            assert!(!record.token.is_empty());
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn only_a_holder_of_the_token_can_raise_the_window() {
        let dir = temp_dir("token");
        let raised = primary(&dir);
        let record = stored(&dir);

        // A local program that can reach the port but has not read the record.
        for line in [
            format!("{PROTOCOL} show not-the-token\n"),
            format!("{PROTOCOL} show \n"),
            format!("{PROTOCOL} {ACTION_SHOW}\n"),
            "\n".to_string(),
            "GET / HTTP/1.1\r\n\r\n".to_string(),
        ] {
            assert_ne!(round_trip(record.port, &line), REPLY_OK, "`{line}` must be refused");
        }
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(raised.load(Ordering::SeqCst), 0, "a refused caller must not raise anything");

        // The launch itself presents the token it wrote.
        assert_eq!(round_trip(record.port, &request_line(&record.token)), REPLY_OK);
        assert_eq!(count_after_settle(&raised), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_request_names_the_protocol_the_action_and_the_token() {
        assert_eq!(parse_request("agentbuddy/1 show abc\n", "abc"), Some(Action::Show));
        // A peer that writes CRLF (every Windows socket library does) is still
        // understood.
        assert_eq!(parse_request("agentbuddy/1 show abc\r\n", "abc"), Some(Action::Show));

        for bad in [
            "",                                   // nothing at all
            "\n",                                 // an empty line
            "agentbuddy/1",                       // no action
            "agentbuddy/1 show",                  // no token
            "agentbuddy/2 show abc",              // another protocol
            "agentbuddy/1 open abc",              // an action that does not exist
            "agentbuddy/1 show abc extra",        // trailing junk
            "agentbuddy/1  show abc",             // an empty field shifts the token
            "agentbuddy/1 show ABC",              // the token is case sensitive
            "agentbuddy/1 SHOW abc",              // so is the action
        ] {
            assert_eq!(parse_request(bad, "abc"), None, "`{bad}` must be refused");
        }
        // An empty token in the hand is not proof of anything.
        assert_eq!(parse_request("agentbuddy/1 show ", ""), None);
        assert_eq!(parse_request("agentbuddy/1 show  ", ""), None);
    }

    #[test]
    fn an_unusable_record_reads_as_no_record() {
        let dir = temp_dir("read");
        fs::create_dir_all(&dir).unwrap();
        let path = record_path(&dir);

        assert_eq!(read_record(&path), None, "a missing record is not an owner");
        for (text, why) in [
            ("{ not json", "not JSON"),
            (r#"{"pid":1,"port":1,"token":""}"#, "no token"),
            (r#"{"pid":1,"port":0,"token":"x"}"#, "no port"),
        ] {
            fs::write(&path, text).unwrap();
            assert_eq!(read_record(&path), None, "{why} must not count as an owner");
        }
        fs::write(&path, r#"{"pid":7,"port":5000,"token":"t"}"#).unwrap();
        assert_eq!(
            read_record(&path),
            Some(Record { pid: 7, port: 5000, token: "t".to_string() })
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_that_cannot_be_written_still_starts_the_app() {
        // A file where the config directory should be: nothing can be published,
        // so arbitration is impossible. Starting without it beats not starting.
        let dir = temp_dir("readonly");
        fs::create_dir_all(dir.parent().unwrap()).unwrap();
        fs::write(&dir, "not a directory").unwrap();
        let Claim::Primary(instance) = claim(&dir) else {
            panic!("a launch that cannot publish must still own the app");
        };
        // Detached: no listener, so serving is a no-op instead of a panic.
        instance.serve(|| panic!("an unwritable directory has no one to serve"));
        let _ = fs::remove_file(&dir);
    }
}
