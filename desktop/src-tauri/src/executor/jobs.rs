//! The node protocol: enroll, poll, report.
//!
//! It is deliberately three verbs and no session. A node parks on a long poll
//! (one request per idle interval, not a timer per job), runs whatever comes
//! back inside its own policy, and posts the result. Nothing about the job is
//! remembered locally: if this process dies mid-job the server sees a failed
//! lease and rebuilds the environment, which is why a crash here cannot corrupt
//! anything upstream.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::spawn::{ExecOutcome, ExecRequest};

/// How a node proves it may poll. The common case is the session this app is
/// already signed in with; an operator running a headless node uses an API key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    Cookie(String),
    ApiKey(String),
    None,
}

impl Credential {
    /// The header pair the request carries, or `None` when there is nothing to
    /// prove identity with — polling then fails with 401 rather than pretending.
    pub fn header(&self) -> Option<(&'static str, String)> {
        match self {
            Credential::Cookie(value) if !value.trim().is_empty() => Some(("cookie", value.clone())),
            Credential::ApiKey(value) if !value.trim().is_empty() => {
                Some(("authorization", format!("Bearer {}", value.trim())))
            }
            _ => None,
        }
    }
}

/// One job as the server sends it. Only the fields the node acts on are modelled;
/// serde ignores the rest, so a server that grows a field cannot break a node.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    #[serde(default)]
    pub op: String,
    #[serde(default)]
    pub lease_id: String,
    #[serde(default)]
    pub request: ExecRequest,
}

/// What the node posts back.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report<'a> {
    exit_code: i32,
    stdout: &'a str,
    stderr: &'a str,
    truncated: bool,
    duration_ms: i64,
    receipt: &'a str,
    error: &'a str,
}

/// Why a poll or a report failed. The kinds are separated because the caller
/// reacts differently: unauthorized needs a fresh credential, unreachable needs a
/// backoff, and a protocol error means this build and the server disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobError {
    Unauthorized,
    Unreachable(String),
    Status(u16),
    Protocol(String),
}

impl std::fmt::Display for JobError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobError::Unauthorized => f.write_str("unauthorized"),
            JobError::Unreachable(reason) => write!(f, "unreachable: {reason}"),
            JobError::Status(code) => write!(f, "http_{code}"),
            JobError::Protocol(reason) => write!(f, "protocol: {reason}"),
        }
    }
}

/// The polling client. One instance per running node; the credential is refreshed
/// by rebuilding it, which is cheaper than caching a session inside it.
#[derive(Debug, Clone)]
pub struct NodeClient {
    http: reqwest::Client,
    base: String,
    node_id: String,
    credential: Credential,
}

impl NodeClient {
    pub fn new(
        http: reqwest::Client,
        base: &str,
        node_id: &str,
        credential: Credential,
    ) -> Self {
        NodeClient {
            http,
            base: base.trim_end_matches('/').to_string(),
            node_id: node_id.to_string(),
            credential,
        }
    }

    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// Enrolls this machine (or refreshes its record) so the console can list it.
    pub async fn enroll(&self, name: &str, capabilities: &[String]) -> Result<(), JobError> {
        let body = serde_json::json!({
            "id": self.node_id,
            "name": name,
            "capabilities": capabilities,
        });
        self.send(self.http.post(self.url("/api/sandbox-nodes")).json(&body), Duration::from_secs(20))
            .await
            .map(|_| ())
    }

    /// Records a liveness beat. Failures are the caller's to log: a node that
    /// cannot heartbeat still finishes the job it already has.
    pub async fn heartbeat(&self) -> Result<(), JobError> {
        let url = self.url(&format!("/api/sandbox-nodes/{}/heartbeat", self.node_id));
        self.send(self.http.post(url), Duration::from_secs(20)).await.map(|_| ())
    }

    /// Long-polls for one job. `Ok(None)` is the normal idle answer, not an error.
    pub async fn claim(&self, wait: Duration) -> Result<Option<Job>, JobError> {
        let url = self.url(&format!(
            "/api/sandbox-nodes/{}/jobs?wait={}",
            self.node_id,
            wait.as_secs().max(1)
        ));
        // The request deadline has to outlast the server's park, otherwise a
        // healthy long poll would look like a dead server.
        let request = self.http.get(url).timeout(wait + Duration::from_secs(15));
        let resp = self.execute(request).await?;
        if resp.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED
            || resp.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err(JobError::Unauthorized);
        }
        if !resp.status().is_success() {
            return Err(status_error(resp.status()));
        }
        let job: Option<Job> = resp.json().await.map_err(|err| JobError::Protocol(err.to_string()))?;
        Ok(job)
    }

    /// Reports a finished job. A refusal here is retried by the caller once: the
    /// server wakes whoever is waiting on the job, so losing the report means the
    /// lease times out instead of failing loudly.
    pub async fn report(&self, job: &Job, outcome: &ExecOutcome) -> Result<(), JobError> {
        let report = Report {
            exit_code: outcome.exit_code,
            stdout: &outcome.stdout,
            stderr: &outcome.stderr,
            truncated: outcome.truncated,
            duration_ms: outcome.duration_ms,
            receipt: "node",
            error: &outcome.error,
        };
        let url = self.url(&format!("/api/sandbox-nodes/{}/jobs/{}", self.node_id, job.id));
        self.send(self.http.post(url).json(&report), Duration::from_secs(30)).await.map(|_| ())
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    async fn send(
        &self,
        request: reqwest::RequestBuilder,
        timeout: Duration,
    ) -> Result<reqwest::StatusCode, JobError> {
        let resp = self.execute(request.timeout(timeout)).await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED
            || resp.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err(JobError::Unauthorized);
        }
        if !resp.status().is_success() {
            return Err(status_error(resp.status()));
        }
        Ok(resp.status())
    }

    async fn execute(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, JobError> {
        let request = match self.credential.header() {
            Some((name, value)) => request.header(name, value),
            None => request,
        };
        // Every transport failure is the same decision for the caller: back off
        // and try again. Only the message differs, so it is kept for the log.
        request.send().await.map_err(|err| JobError::Unreachable(err.to_string()))
    }
}

fn status_error(status: reqwest::StatusCode) -> JobError {
    JobError::Status(status.as_u16())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use axum::routing::{any, post};
    use std::sync::{Arc, Mutex};

    /// The smallest stand-in for the agenthub node endpoints: it records what it
    /// was told and answers with the job the test handed it.
    struct Fake {
        base: String,
        seen: Arc<Mutex<Vec<String>>>,
    }

    async fn fake_server(job: Option<serde_json::Value>, reject: bool) -> Fake {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let enroll_log = seen.clone();
        let heartbeat_log = seen.clone();
        let report_log = seen.clone();
        let app = axum::Router::new()
            .route(
                "/api/sandbox-nodes",
                post(move |body: String| {
                    let log = enroll_log.clone();
                    async move {
                        log.lock().unwrap().push(format!("enroll {body}"));
                        axum::Json(serde_json::json!({"id": "node-1"}))
                    }
                }),
            )
            .route(
                "/api/sandbox-nodes/node-1/heartbeat",
                post(move || {
                    let log = heartbeat_log.clone();
                    async move {
                        log.lock().unwrap().push("heartbeat".to_string());
                        axum::Json(serde_json::json!({"ok": true}))
                    }
                }),
            )
            .route(
                "/api/sandbox-nodes/node-1/jobs",
                any(move |headers: axum::http::HeaderMap| {
                    let job = job.clone();
                    async move {
                        let proved = headers.contains_key("authorization") || headers.contains_key("cookie");
                        if reject || !proved {
                            return (
                                StatusCode::UNAUTHORIZED,
                                axum::Json(serde_json::json!({"code": "unauthenticated"})),
                            )
                                .into_response();
                        }
                        match job {
                            None => StatusCode::NO_CONTENT.into_response(),
                            Some(job) => axum::Json(job).into_response(),
                        }
                    }
                }),
            )
            .route(
                "/api/sandbox-nodes/node-1/jobs/job-1",
                post(move |body: String| {
                    let log = report_log.clone();
                    async move {
                        log.lock().unwrap().push(format!("report {body}"));
                        axum::Json(serde_json::json!({"ok": true}))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Fake { base: format!("http://127.0.0.1:{port}"), seen }
    }

    fn client(base: &str, credential: Credential) -> NodeClient {
        NodeClient::new(reqwest::Client::new(), base, "node-1", credential)
    }

    #[tokio::test]
    async fn enrolls_sends_a_heartbeat_and_reports_a_result() {
        let fake = fake_server(None, false).await;
        let node = client(&fake.base, Credential::ApiKey("k".into()));

        node.enroll("laptop", &["remote".to_string()]).await.unwrap();
        node.heartbeat().await.unwrap();
        let job = Job {
            id: "job-1".into(),
            op: "exec".into(),
            lease_id: "l1".into(),
            request: ExecRequest { command: "echo".into(), ..Default::default() },
        };
        let outcome = ExecOutcome { exit_code: 0, stdout: "hi".into(), ..Default::default() };
        node.report(&job, &outcome).await.unwrap();

        let seen = fake.seen.lock().unwrap().clone();
        assert!(seen[0].contains("\"id\":\"node-1\""), "enrollment carries the node id");
        assert_eq!(seen[1], "heartbeat");
        assert!(seen[2].contains("\"exitCode\":0"), "the report carries the exit code");
        assert!(seen[2].contains("\"stdout\":\"hi\""));
    }

    #[tokio::test]
    async fn an_idle_poll_is_not_an_error() {
        let fake = fake_server(None, false).await;
        let node = client(&fake.base, Credential::Cookie("sid=1".into()));
        assert!(node.claim(Duration::from_millis(10)).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_polled_job_comes_back_parsed() {
        let job = serde_json::json!({
            "id": "job-1",
            "op": "exec",
            "leaseId": "l1",
            "request": {"command": "git", "args": ["status"], "timeoutMs": 1000, "maxOutputBytes": 2048}
        });
        let fake = fake_server(Some(job), false).await;
        let node = client(&fake.base, Credential::ApiKey("k".into()));
        let job = node.claim(Duration::from_millis(10)).await.unwrap().expect("a job");
        assert_eq!(job.id, "job-1");
        assert_eq!(job.lease_id, "l1");
        assert_eq!(job.request.command, "git");
        assert_eq!(job.request.args, vec!["status"]);
        assert_eq!(job.request.timeout_ms, 1000);
        assert_eq!(job.request.max_output_bytes, 2048);
    }

    #[tokio::test]
    async fn a_refused_poll_is_reported_as_unauthorized() {
        let fake = fake_server(None, true).await;
        let node = client(&fake.base, Credential::ApiKey("k".into()));
        assert_eq!(node.claim(Duration::from_millis(10)).await.unwrap_err(), JobError::Unauthorized);
    }

    #[tokio::test]
    async fn no_credential_is_a_refusal_not_an_anonymous_poll() {
        let fake = fake_server(None, false).await;
        let node = client(&fake.base, Credential::None);
        assert_eq!(node.claim(Duration::from_millis(10)).await.unwrap_err(), JobError::Unauthorized);
        assert_eq!(Credential::Cookie(String::new()).header(), None);
        assert_eq!(Credential::None.header(), None);
    }

    #[tokio::test]
    async fn an_unreachable_server_is_distinguished_from_a_refusal() {
        // Port 1 on loopback: nothing listens there, so the failure is transport.
        let node = client("http://127.0.0.1:1", Credential::ApiKey("k".into()));
        match node.enroll("laptop", &[]).await.unwrap_err() {
            JobError::Unreachable(_) => {}
            other => panic!("expected a transport failure, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_wrong_shape_answer_is_a_protocol_error() {
        let job = serde_json::json!({"unexpected": true});
        let fake = fake_server(Some(job), false).await;
        let node = client(&fake.base, Credential::ApiKey("k".into()));
        // A missing `id` cannot be a job: the node refuses rather than reporting
        // against an empty identifier.
        assert!(matches!(node.claim(Duration::from_millis(10)).await, Err(JobError::Protocol(_))));
    }

    #[test]
    fn error_display_names_the_failure() {
        assert_eq!(JobError::Unauthorized.to_string(), "unauthorized");
        assert_eq!(JobError::Status(503).to_string(), "http_503");
        assert_eq!(JobError::Unreachable("nope".into()).to_string(), "unreachable: nope");
    }
}
