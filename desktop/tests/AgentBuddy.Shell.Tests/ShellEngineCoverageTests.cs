using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using AgentBuddy.Core.Contracts;
using AgentBuddy.Core.Gateway;
using AgentBuddy.Core.Services;
using AgentBuddy.Shell;
using AgentBuddy.Shell.Credentials;
using AgentBuddy.Shell.Executor;
using AgentBuddy.Shell.Notifications;
using AgentBuddy.Shell.Tray;
using AgentBuddy.Shell.Upgrade;
using Xunit;

namespace AgentBuddy.Shell.Tests;

/// <summary>Policy decisions and the real spawn path of the BYOM executor.</summary>
public class ExecutorCoverageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));

    public ExecutorCoverageTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (Exception) { /* the child may still hold it */ }
    }

    [Fact]
    public void RootsMustBeAbsoluteExistingAndNeverTheFileSystemRoot()
    {
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot(""));
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot("relative/path"));
        Assert.Equal(ExecutorReject.RootUnusable, ExecutorPolicy.ValidateRoot(Path.Combine(_root, "missing")));
        Assert.Equal(ExecutorReject.RootUnusable,
            ExecutorPolicy.ValidateRoot(Path.GetPathRoot(_root)!));
        Assert.Null(ExecutorPolicy.ValidateRoot(_root));
        Assert.Null(ExecutorPolicy.ValidateRoot(_root + Path.DirectorySeparatorChar));
    }

    [Theory]
    [InlineData("", ExecutorReject.CommandNotAllowed)]
    [InlineData(" node", ExecutorReject.CommandNotAllowed)]
    [InlineData("node ", ExecutorReject.CommandNotAllowed)]
    [InlineData("../node", ExecutorReject.CommandNotAllowed)]
    [InlineData("/usr/bin/node", ExecutorReject.CommandNotAllowed)]
    [InlineData("C:\\node.exe", ExecutorReject.CommandNotAllowed)]
    [InlineData(".", ExecutorReject.CommandNotAllowed)]
    [InlineData("..", ExecutorReject.CommandNotAllowed)]
    [InlineData("no\u0001de", ExecutorReject.CommandNotAllowed)]
    [InlineData("bash", ExecutorReject.CommandNotAllowed)]
    [InlineData("BASH", ExecutorReject.CommandNotAllowed)]
    [InlineData("sudo", ExecutorReject.CommandNotAllowed)]
    [InlineData("docker", ExecutorReject.CommandNotAllowed)]
    [InlineData("python3", ExecutorReject.CommandNotAllowed)]  // simply not allowlisted
    [InlineData("node", null)]
    public void CommandsAreMatchedByExactBareNameOnly(string command, string? expected) =>
        Assert.Equal(expected, ExecutorPolicy.ValidateCommand(command, ["node", "bash", "sudo", "docker"]));

    [Fact]
    public void WorkDirectoriesStayInsideTheResolvedRoot()
    {
        var child = Path.Combine(_root, "child");
        Directory.CreateDirectory(child);
        var sibling = Path.Combine(Path.GetTempPath(), "ab-sibling-" + Guid.NewGuid().ToString("N"));
        Assert.Null(ExecutorPolicy.ValidateWorkDir(_root, _root));
        Assert.Null(ExecutorPolicy.ValidateWorkDir(_root, child));
        Assert.Equal(ExecutorReject.DirOutsideRoot, ExecutorPolicy.ValidateWorkDir(_root, sibling));
        // A prefix that is not a whole segment is still outside ("/root2" vs "/root").
        Assert.Equal(ExecutorReject.DirOutsideRoot,
            ExecutorPolicy.ValidateWorkDir(_root, _root + "2"));
    }

    [Fact]
    public void EnvironmentKeysAreAllowlistedExactly()
    {
        Assert.Null(ExecutorPolicy.ValidateEnvironment(new Dictionary<string, string>()));
        Assert.Null(ExecutorPolicy.ValidateEnvironment(new Dictionary<string, string> { ["PATH"] = "/bin", ["TEMP"] = _root }));
        Assert.Equal(ExecutorReject.EnvNotAllowed,
            ExecutorPolicy.ValidateEnvironment(new Dictionary<string, string> { ["AWS_SECRET"] = "x" }));
    }

    [Theory]
    [InlineData(null, ExecutorReject.CommandNotAllowed)]
    [InlineData("", ExecutorReject.CommandNotAllowed)]
    [InlineData(" node", ExecutorReject.CommandNotAllowed)]
    [InlineData("node -v", ExecutorReject.CommandNotAllowed)]
    [InlineData("dir/node", ExecutorReject.CommandNotAllowed)]
    [InlineData("dir\\node", ExecutorReject.CommandNotAllowed)]
    [InlineData("C:\\node.exe", ExecutorReject.CommandNotAllowed)]
    [InlineData(".", ExecutorReject.CommandNotAllowed)]
    [InlineData("pwsh", ExecutorReject.CommandNotAllowed)]
    [InlineData("timeout", ExecutorReject.CommandNotAllowed)]
    [InlineData("node", null)]
    public void AllowlistEntriesAreCommandNamesNotCommandLines(string? entry, string? expected) =>
        Assert.Equal(expected, ExecutorPolicy.ValidateAllowlistEntry(entry));

    [Fact]
    public void OutputIsTruncatedWithAMarkerAndPathsResolveWithoutThrowing()
    {
        Assert.Equal("short", ExecutorPolicy.Truncate("short"));
        var long1 = ExecutorPolicy.Truncate(new string('x', Limits.MaxOutputBytes + 1));
        Assert.Contains("[truncated]", long1);

        Assert.Equal(_root, ExecutorPolicy.ResolveExisting(_root));
        var missing = Path.Combine(_root, "a", "b", "c.txt");
        Assert.Equal(missing, ExecutorPolicy.ResolveExisting(missing));
        var file = Path.Combine(_root, "note.txt");
        File.WriteAllText(file, "x");
        Assert.Equal(file, ExecutorPolicy.ResolveExisting(file));
    }

    [Fact]
    public void TerminatingATreeHandlesBothALiveAndAFinishedChild()
    {
        var finished = TestProbe.Echo();
        if (finished is not null)
        {
            using (finished)
            {
                finished.WaitForExit(10_000);
                ProcGroup.TerminateTree(finished); // already exited: nothing to signal
            }
        }

        var live = TestProbe.Sleeper();
        if (live is null) return;
        using (live)
        {
            ProcGroup.TerminateTree(live);
            Assert.True(live.HasExited || live.WaitForExit(5000));
        }
    }

    [Fact]
    public async Task DisabledRootCommandWorkDirAndEnvironmentAreAllRefused()
    {
        var executor = new ExecutorService(new NullStore());
        var config = new ShellConfig { ExecutorRoot = _root, ExecutorAllowlist = ["dotnet"] };
        await Assert.ThrowsAsync<ExecutorRejectException>(
            () => executor.ExecuteAsync(config, new ExecRequest("dotnet", [], _root)));

        executor.SetEnabled(true, true);
        var disabledRoot = config with { ExecutorRoot = "" };
        Assert.Equal(ExecutorReject.RootUnusable,
            (await Assert.ThrowsAsync<ExecutorRejectException>(
                () => executor.ExecuteAsync(disabledRoot, new ExecRequest("dotnet", [], _root)))).Reason);
        Assert.Equal(ExecutorReject.CommandNotAllowed,
            (await Assert.ThrowsAsync<ExecutorRejectException>(
                () => executor.ExecuteAsync(config, new ExecRequest("bash", [], _root)))).Reason);
        Assert.Equal(ExecutorReject.DirOutsideRoot,
            (await Assert.ThrowsAsync<ExecutorRejectException>(
                () => executor.ExecuteAsync(config, new ExecRequest("dotnet", [], Path.GetTempPath() + "2")))).Reason);
        Assert.Equal(ExecutorReject.EnvNotAllowed,
            (await Assert.ThrowsAsync<ExecutorRejectException>(
                () => executor.ExecuteAsync(config,
                    new ExecRequest("dotnet", [], _root, new Dictionary<string, string> { ["AWS_SECRET"] = "x" })))).Reason);
        var missing = new ShellConfig { ExecutorRoot = _root, ExecutorAllowlist = ["definitely-not-a-real-program"] };
        Assert.Equal(ExecutorReject.SpawnFailed,
            (await Assert.ThrowsAsync<ExecutorRejectException>(
                () => executor.ExecuteAsync(missing,
                    new ExecRequest("definitely-not-a-real-program", [], _root)))).Reason);
    }

    [Fact]
    public async Task AnAllowlistedCommandReallyRunsWithArgvAndABoundedEnvironment()
    {
        if (!OperatingSystem.IsWindows()) return;
        var executor = new ExecutorService(new NullStore());
        executor.SetEnabled(true, true);
        var config = new ShellConfig
        {
            ExecutorRoot = _root,
            ExecutorAllowlist = ["whoami"],
            ExecutorMaxConcurrency = 4
        };
        var result = await executor.ExecuteAsync(config,
            new ExecRequest("whoami", [], _root, new Dictionary<string, string> { ["TZ"] = "UTC" }));
        Assert.Equal(0, result.ExitCode);
        Assert.False(string.IsNullOrWhiteSpace(result.Stdout));
        Assert.False(result.TimedOut);

        // The concurrency limit is re-applied when the setting changes.
        var narrowed = await executor.ExecuteAsync(config with { ExecutorMaxConcurrency = 8 },
            new ExecRequest("whoami", [], _root));
        Assert.Equal(0, narrowed.ExitCode);

        // Cancellation propagates instead of being reported as a timeout.
        var slow = config with { ExecutorAllowlist = ["ping"] };
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => executor.ExecuteAsync(slow,
            new ExecRequest("ping", ["-n", "20", "127.0.0.1"], _root), cancel.Token));
    }

    [Fact]
    public async Task ChattyCommandsAreTruncatedInsteadOfBuffered()
    {
        if (!OperatingSystem.IsWindows()) return;
        var executor = new ExecutorService(new NullStore());
        executor.SetEnabled(true, true);
        var config = new ShellConfig { ExecutorRoot = _root, ExecutorAllowlist = ["where"] };
        var result = await executor.ExecuteAsync(config,
            new ExecRequest("where", ["/r", Environment.SystemDirectory, "*.dll"], _root));
        Assert.Equal(0, result.ExitCode);
        Assert.Contains("[truncated]", result.Stdout);
        Assert.True(result.Stdout.Length <= Limits.MaxOutputBytes + "\n[truncated]".Length);
    }

    [Fact]
    public async Task NodeJobsUseTheThreeVerbProtocolAndNeedAKeyToEnroll()
    {
        var hub = new RecordingHub();
        var withoutKey = new NodeJobs(hub, new NullStore());
        var error = await Assert.ThrowsAsync<HubApiException>(() => withoutKey.EnrollAsync("n1", "node", ["shell"]));
        Assert.Equal(ErrorCodes.Unauthenticated, error.Code);

        var credentials = new MemoryStore();
        credentials.Values["executor_api_key"] = "k";
        var jobs = new NodeJobs(hub, credentials);
        await jobs.EnrollAsync("n1", "node", ["shell"]);
        await jobs.HeartbeatAsync("n1");
        await jobs.ClaimAsync("n1", 0);
        await jobs.ReportAsync("n1", "job-1", new ExecResult(3, "out", "err", false));

        Assert.Equal(Endpoints.SandboxNodes, hub.Calls[0].Path);
        Assert.Equal(Endpoints.Format(Endpoints.SandboxNodeHeartbeat, ("id", "n1")), hub.Calls[1].Path);
        Assert.Equal("/api/sandbox-nodes/n1/jobs?wait=1", hub.Calls[2].Path); // wait is clamped to >= 1
        Assert.Equal(Endpoints.Format(Endpoints.SandboxNodeJobById, ("id", "n1"), ("jobId", "job-1")), hub.Calls[3].Path);
        Assert.Contains("\"exitCode\":3", hub.Calls[3].Body);
    }

    [Fact]
    public async Task TheApiKeyIsReportedWithoutLeakingIt()
    {
        var credentials = new MemoryStore();
        var executor = new ExecutorService(credentials);
        Assert.False(await executor.HasApiKeyAsync());
        credentials.Values["executor_api_key"] = "k";
        Assert.True(await executor.HasApiKeyAsync());
        Assert.True(executor.Limits.ShellsRefused);
    }

    private sealed class NullStore : ICredentialStore
    {
        public string Backend => "memory";
        public Task<string?> GetAsync(string name, CancellationToken ct = default) => Task.FromResult<string?>(null);
        public Task SetAsync(string name, string secret, CancellationToken ct = default) => Task.CompletedTask;
        public Task DeleteAsync(string name, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class MemoryStore : ICredentialStore
    {
        public Dictionary<string, string> Values { get; } = new(StringComparer.Ordinal);
        public string Backend => "memory";
        public Task<string?> GetAsync(string name, CancellationToken ct = default) =>
            Task.FromResult(Values.TryGetValue(name, out var v) ? v : null);
        public Task SetAsync(string name, string secret, CancellationToken ct = default)
        {
            Values[name] = secret;
            return Task.CompletedTask;
        }
        public Task DeleteAsync(string name, CancellationToken ct = default)
        {
            Values.Remove(name);
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingHub : IAgentHubClient
    {
        public List<(string Path, string Body)> Calls { get; } = [];

        public Task<JsonElement?> SendAsync(string path, HttpMethod method, object? body = null, CancellationToken ct = default)
        {
            Calls.Add((path, body is null ? "" : JsonSerializer.Serialize(body)));
            return Task.FromResult<JsonElement?>(null);
        }

        public IAsyncEnumerable<HubEvent> SubscribeAsync(string path, long? since = null, CancellationToken ct = default)
            => Empty();

        private static async IAsyncEnumerable<HubEvent> Empty()
        {
            await Task.Yield();
            yield break;
        }

        public Task<Stream> DownloadAsync(string path, CancellationToken ct = default) => Task.FromResult<Stream>(new MemoryStream());
        public Task<JsonElement?> UploadAsync(string path, Stream content, string field, string fileName,
            IProgress<int>? progress = null, CancellationToken ct = default) => Task.FromResult<JsonElement?>(null);
        public Task<JsonElement?> PostAudioAsync(long threadId, Stream audio, CancellationToken ct = default)
            => Task.FromResult<JsonElement?>(null);
    }
}

/// <summary>The three-tier credential ladder, the private file store and the helper runner.</summary>
public class CredentialCoverageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));

    public CredentialCoverageTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (Exception) { /* best effort */ }
    }

    [Fact]
    public async Task ThePrivateFileStoreRoundTripsAndToleratesItsOwnLifecycle()
    {
        var store = new FileCredentialStore(new AppPaths(_root));
        Assert.Equal("file", store.Backend);
        Assert.Null(await store.GetAsync("session"));
        await store.SetAsync("session", "v");
        Assert.Equal("v", await store.GetAsync("session"));
        await store.DeleteAsync("session");
        Assert.Null(await store.GetAsync("session"));
        await store.DeleteAsync("session"); // deleting twice is a no-op
    }

    [Fact]
    public async Task ACorruptSecretFileThrowsSoTheLadderCanFallBack()
    {
        var store = new FileCredentialStore(new AppPaths(_root));
        await store.SetAsync("session", "v");
        var file = Directory.GetFiles(Path.Combine(_root, "agentbuddy", "secrets")).Single();
        await File.WriteAllTextAsync(file, "{ corrupt");
        await Assert.ThrowsAnyAsync<JsonException>(() => store.GetAsync("session"));
    }

    [Fact]
    public async Task TheNoopStoreRefusesToWrite()
    {
        var store = new NoopCredentialStore();
        Assert.Equal("memory", store.Backend);
        Assert.NotNull(store.GetAsync("x"));
        await Assert.ThrowsAsync<NotSupportedException>(() => store.SetAsync("x", "y"));
        Assert.NotNull(store.DeleteAsync("x"));
    }

    [Fact]
    public async Task TheLadderPrefersThePrimaryThenTheFileThenSignedOut()
    {
        var paths = new AppPaths(_root);
        var primary = new StubStore("keyring");
        var ladder = new CredentialStore(paths, primary);

        primary.Value = "from-keyring";
        Assert.Equal("from-keyring", await ladder.GetAsync("session"));
        Assert.Equal("keyring", ladder.Backend);

        primary.Value = null;
        Assert.Null(await ladder.GetAsync("session"));
        Assert.Equal("memory", ladder.Backend);

        await new FileCredentialStore(paths).SetAsync("session", "from-file");
        Assert.Equal("from-file", await ladder.GetAsync("session"));
        Assert.Equal("file", ladder.Backend);

        primary.Fail = true;
        Assert.Equal("from-file", await ladder.GetAsync("session"));
        Assert.Equal("file", ladder.Backend);

        // A primary that throws and a file that cannot be parsed is "signed out".
        var file = Directory.GetFiles(Path.Combine(_root, "agentbuddy", "secrets")).Single();
        await File.WriteAllTextAsync(file, "{ corrupt");
        Assert.Null(await ladder.GetAsync("session"));
        Assert.Equal("memory", ladder.Backend);
    }

    [Fact]
    public async Task SetFallsBackToThePrivateFileAndDeleteIsBestEffort()
    {
        var paths = new AppPaths(_root);
        var primary = new StubStore("keyring");
        var ladder = new CredentialStore(paths, primary);

        await ladder.SetAsync("session", "one");
        Assert.Equal("keyring", ladder.Backend);
        Assert.Equal("one", primary.Value);

        primary.Fail = true;
        await ladder.SetAsync("session", "two");
        Assert.Equal("file", ladder.Backend);
        Assert.Equal("two", await new FileCredentialStore(paths).GetAsync("session"));

        await ladder.DeleteAsync("session"); // the throwing primary must not stop the file delete
        Assert.Null(await new FileCredentialStore(paths).GetAsync("session"));
    }

    [Fact]
    public void PathLookupFindsRealHelpersAndIgnoresJunkEntries()
    {
        Assert.False(CredentialStore.Exists("definitely-not-a-program-" + Guid.NewGuid().ToString("N")));
        if (OperatingSystem.IsWindows()) Assert.True(CredentialStore.Exists("where.exe"));
    }

    [Fact]
    public async Task TheWindowsStoreRoundTripsThroughTheCredentialManager()
    {
        if (!OperatingSystem.IsWindows()) return;
        var store = new WindowsCredentialStore();
        var name = "cov-" + Guid.NewGuid().ToString("N");
        Assert.Equal("keyring", store.Backend);
        Assert.Null(await store.GetAsync(name));
        try
        {
            await store.SetAsync(name, "secret-" + name);
            Assert.Equal("secret-" + name, await store.GetAsync(name));
        }
        finally { await store.DeleteAsync(name); }
        Assert.Null(await store.GetAsync(name));
    }

    [Fact]
    public async Task TheUnixStoresNameTheirBackendAndFailClosedWithoutTheirHelper()
    {
        Assert.Equal("keychain", new UnixCommandCredentialStore("macos").Backend);
        Assert.Equal("secret-service", new UnixCommandCredentialStore("linux").Backend);
        Assert.NotNull(new UnixCommandCredentialStore("linux").DeleteAsync("x"));

        if (OperatingSystem.IsWindows())
        {
            // Neither "security" nor "secret-tool" exists here: the call fails closed.
            await Assert.ThrowsAnyAsync<Exception>(() => new UnixCommandCredentialStore("macos").GetAsync("x"));
            await Assert.ThrowsAnyAsync<Exception>(() => new UnixCommandCredentialStore("linux").SetAsync("x", "y"));
        }
    }

    [Fact]
    public async Task TheHelperRunnerReturnsStdoutOnlyOnSuccessAndKillsOnTimeout()
    {
        if (!OperatingSystem.IsWindows()) return;

        var output = await UnixCommandCredentialStore.RunAsync("where.exe", ["where"], null, CancellationToken.None);
        Assert.False(string.IsNullOrWhiteSpace(output));

        Assert.Null(await UnixCommandCredentialStore.RunAsync("where.exe",
            ["definitely-not-a-program-" + Guid.NewGuid().ToString("N")], null, CancellationToken.None));

        // stdin is written and closed for helpers that read the secret from a pipe.
        var piped = await UnixCommandCredentialStore.RunAsync("findstr.exe", ["hit"], "hit\n", CancellationToken.None);
        Assert.Contains("hit", piped);

        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await Assert.ThrowsAsync<TimeoutException>(() =>
            UnixCommandCredentialStore.RunAsync("ping.exe", ["-n", "20", "127.0.0.1"], null, cancel.Token));
    }

    private sealed class StubStore(string backend) : ICredentialStore
    {
        public string? Value { get; set; }
        public bool Fail { get; set; }
        public string Backend => backend;

        public Task<string?> GetAsync(string name, CancellationToken ct = default) =>
            Fail ? throw new InvalidOperationException("locked") : Task.FromResult(Value);

        public Task SetAsync(string name, string secret, CancellationToken ct = default)
        {
            if (Fail) throw new InvalidOperationException("locked");
            Value = secret;
            return Task.CompletedTask;
        }

        public Task DeleteAsync(string name, CancellationToken ct = default)
        {
            if (Fail) throw new InvalidOperationException("locked");
            Value = null;
            return Task.CompletedTask;
        }
    }
}

/// <summary>Source race, downloader, verifier, semver, the install state machine and the installer.</summary>
public class UpgradeCoverageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N"));

    public UpgradeCoverageTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (Exception) { /* best effort */ }
    }

    private static string Manifest(string version, string? url = null, string? signature = "sig",
        string name = "agentbuddy-9.9.9.msi") => JsonSerializer.Serialize(new
    {
        version,
        notes = "notes",
        pub_date = "2026-01-01T00:00:00Z",
        platforms = new Dictionary<string, object>
        {
            ["windows-x86_64"] = new
            {
                url = url ?? $"https://github.com/ariacompute/agentbuddy/releases/download/v9/{name}",
                signature = signature ?? ""
            }
        },
        signatures = signature is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string> { [name] = signature }
    });

    [Fact]
    public async Task TheSourceRaceTakesTheFirstUsableAnswer()
    {
        var race = new SourceRace(new HttpClient(new FakeHttp(request => request.RequestUri!.Host switch
        {
            "api.github.com" or "github.com" => Ok(Manifest("9.9.9")),
            "gitee.com" when request.RequestUri.AbsolutePath.Contains("/api/") => Ok("""{"tag_name":"v9.9.9"}"""),
            "gitee.com" => Ok(Manifest("9.9.9")),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        })));
        var probe = await race.ProbeAsync(CancellationToken.None);
        Assert.Null(probe.Error);
        Assert.Contains(probe.Source, new[] { "github", "gitee" });
        Assert.False(string.IsNullOrWhiteSpace(probe.Json));
    }

    [Fact]
    public async Task TheSourceRaceReportsMachineReasonsForEveryFailure()
    {
        var notFound = new SourceRace(new HttpClient(new FakeHttp(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));
        var probe = await notFound.ProbeAsync(CancellationToken.None);
        Assert.Equal("network_failed", probe.Error);

        var emptyTag = new SourceRace(new HttpClient(new FakeHttp(request =>
            request.RequestUri!.Host == "gitee.com" && request.RequestUri.AbsolutePath.Contains("/api/")
                ? Ok("{}")
                : Ok(Manifest("9.9.9")))));
        var empty = await emptyTag.ProbeAsync(CancellationToken.None);
        Assert.Null(empty.Error); // github still answers

        var oversized = new SourceRace(new HttpClient(new FakeHttp(_ => Ok(new string('x', Limits.MaxManifestBytes + 1)))));
        Assert.Equal("manifest_invalid", (await oversized.ProbeAsync(CancellationToken.None)).Error);

        var throws = new SourceRace(new HttpClient(new FakeHttp(_ => throw new OperationCanceledException())));
        Assert.Equal("network_failed", (await throws.ProbeAsync(CancellationToken.None)).Error);

        var broken = new SourceRace(new HttpClient(new FakeHttp(_ => throw new HttpRequestException("down"))));
        Assert.Equal("network_failed", (await broken.ProbeAsync(CancellationToken.None)).Error);
    }

    [Fact]
    public async Task TheDownloaderRefusesOversizedPackagesBeforeAndDuringTheRead()
    {
        var ok = new HttpReleaseDownloader(new HttpClient(new FakeHttp(_ => Ok("payload"))));
        Assert.Equal("payload", Encoding.UTF8.GetString(await ok.DownloadAsync("https://x/y", CancellationToken.None)));

        var missing = new HttpReleaseDownloader(new HttpClient(new FakeHttp(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));
        await Assert.ThrowsAsync<HttpRequestException>(() => missing.DownloadAsync("https://x/y", CancellationToken.None));

        var declared = new HttpReleaseDownloader(new HttpClient(new FakeHttp(_ =>
        {
            var response = Ok("");
            response.Content.Headers.ContentLength = Limits.MaxPackageBytes + 1L;
            return response;
        })));
        await Assert.ThrowsAsync<InvalidOperationException>(() => declared.DownloadAsync("https://x/y", CancellationToken.None));
    }

    [Fact]
    public void MinisignBoxesAreDecodedStrictly()
    {
        var payload = new byte[42];
        payload[0] = (byte)'E'; payload[1] = (byte)'d';
        var text = "untrusted comment: test\n" + Convert.ToBase64String(payload) + "\ntrusted comment: t\n";
        Assert.Equal(payload, MinisignVerifier.Decode(text, 42));
        Assert.Equal(payload, MinisignVerifier.Decode(Convert.ToBase64String(Encoding.UTF8.GetBytes(text)), 42));
        Assert.Throws<FormatException>(() => MinisignVerifier.Decode("untrusted comment: t\nAAAA\n", 42));

        var verifier = new MinisignVerifier();
        Assert.False(verifier.Verify([], text, text));
        Assert.False(verifier.Verify([1, 2, 3], "", text));
        Assert.False(verifier.Verify([1, 2, 3], text, ""));
        Assert.False(verifier.Verify([1, 2, 3], "not a box", "not a box"));
        Assert.False(verifier.Verify([1, 2, 3], text, text)); // magic ok, signature nonsense
    }

    [Fact]
    public void SemverHandlesPrefixesBuildMetadataAndPreReleaseOrdering()
    {
        Assert.Equal(0, SemverComparer.Compare("v1.2.3+build.5", "1.2.3"));
        Assert.True(SemverComparer.Compare("1.3", "1.2.9") > 0);
        Assert.True(SemverComparer.Compare("1.2.3-alpha", "1.2.3-beta") < 0);
        Assert.True(SemverComparer.Compare("1.2.3-beta", "1.2.3-alpha") > 0);
        Assert.Equal(0, SemverComparer.Compare("1.x.3", "1.0.3"));
    }

    [Fact]
    public async Task TheInstallCommandIsDescribedForEachPlatformAndRefusedElsewhere()
    {
        var windows = PlatformUpgradeInstaller.DescribeInstall("C:\\t\\a.msi", "a.msi", "windows")!.Value;
        Assert.Equal("msiexec", windows.Start.FileName);
        Assert.Equal(new[] { "/i", "C:\\t\\a.msi", "/passive" }, windows.Start.ArgumentList.ToArray());
        Assert.True(windows.CleanUp);

        var mac = PlatformUpgradeInstaller.DescribeInstall("/tmp/a.dmg", "a.dmg", "macos")!.Value;
        Assert.Equal("open", mac.Start.FileName);
        Assert.False(mac.CleanUp); // the image must outlive the call

        var linux = PlatformUpgradeInstaller.DescribeInstall("/tmp/a.deb", "a.deb", "linux")!.Value;
        Assert.Equal("dpkg", linux.Start.FileName);
        Assert.True(linux.CleanUp);

        Assert.Null(PlatformUpgradeInstaller.DescribeInstall("/tmp/a.deb", "a.deb", "windows"));
        Assert.Null(PlatformUpgradeInstaller.DescribeInstall("/tmp/a.msi", "a.msi", "macos"));
        Assert.Null(PlatformUpgradeInstaller.DescribeInstall("/tmp/a.zip", "a.zip", "linux"));

        // Omitting os defers to the running platform, so the package has to be the
        // one this OS installs: a hard-coded .msi has no plan on macOS and Linux,
        // which is exactly where CI runs this.
        var (nativeFile, nativeName) = OperatingSystem.IsWindows() ? ("/tmp/a.msi", "a.msi")
            : OperatingSystem.IsMacOS() ? ("/tmp/a.dmg", "a.dmg")
            : ("/tmp/a.deb", "a.deb");
        Assert.NotNull(PlatformUpgradeInstaller.DescribeInstall(nativeFile, nativeName));
    }

    [Fact]
    public async Task TheInstallerRefusesUnsafeNamesAndUnknownPackages()
    {
        var installer = new PlatformUpgradeInstaller();
        foreach (var name in new[] { "", " ", "../x.msi", "a/b.msi", "a\\b.msi", ".", ".." })
            Assert.False(await installer.InstallAsync([1], name, CancellationToken.None));
        Assert.False(await installer.InstallAsync([1], "a.zip", CancellationToken.None));
    }

    [Fact]
    public async Task ChecksReportBusyManifestSignatureAndPlatformOutcomes()
    {
        var gate = new TaskCompletionSource<ReleaseProbe>();
        var blocking = new Source(() => gate.Task);
        var busy = Build(blocking, "pubkey", _root);
        var first = busy.CheckAsync();
        await Task.Delay(50);
        Assert.Equal("busy", (await busy.CheckAsync()).Status);
        gate.SetResult(new ReleaseProbe("github", Manifest("9.9.9"), 1));
        await first;

        Assert.Equal("manifest_invalid", (await Build(
            new Source(() => Task.FromResult(new ReleaseProbe("github", "{ not json", 1))), "k", _root).CheckAsync()).Status);
        Assert.Equal("manifest_invalid", (await Build(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("nightly"), 1))), "k", _root).CheckAsync()).Status);
        Assert.Equal("unsupported_platform", (await Build(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9"), 1))), "k", _root,
            platform: "plan9-x86_64").CheckAsync()).Status);
        Assert.Equal("unsupported_platform", (await Build(
            new Source(() => Task.FromResult(new ReleaseProbe("github",
                Manifest("9.9.9", url: "https://evil.test/a.msi"), 1))), "k", _root).CheckAsync()).Status);
        Assert.Equal("manifest_invalid", (await Build(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9", signature: null), 1))), "k", _root)
            .CheckAsync()).Status);

        using var cancel = new CancellationTokenSource();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Build(
            new Source(() => throw new OperationCanceledException()), "k", _root).CheckAsync(true, cancel.Token));
    }

    [Fact]
    public async Task ASkippedVersionStaysQuietUnlessTheCheckIsManual()
    {
        var config = new ConfigService(new AppPaths(Path.Combine(_root, "cfg")));
        await config.SaveAsync(new ShellConfig { UpgradeSkippedVersion = "9.9.9" });
        var service = new UpgradeService(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9"), 1))),
            new Downloader(() => [1, 2, 3]), new Verifier(true), new Installer(true), config, "0.1.0", "k", "windows-x86_64");
        Assert.Equal("up_to_date", (await service.CheckAsync()).Status);
        Assert.Equal("available", (await service.CheckAsync(manual: true)).Status);
    }

    [Fact]
    public async Task InstallRequiresAnOfferThenVerifiesSignatureAndInstallerResult()
    {
        var config = new ConfigService(new AppPaths(Path.Combine(_root, "cfg2")));
        var idle = new UpgradeService(new Source(() => Task.FromResult(new ReleaseProbe("github", "", 1, "network_failed"))),
            new Downloader(() => [1]), new Verifier(true), new Installer(true), config, "0.1.0", "k", "windows-x86_64");
        Assert.Equal("unavailable", (await idle.InstallAsync()).Status);

        var noKey = new UpgradeService(new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9"), 1))),
            new Downloader(() => [1]), new Verifier(true), new Installer(true), config, "0.1.0", "", "windows-x86_64");
        Assert.Equal("not_configured", (await noKey.InstallAsync()).Status);

        var downloadFails = new UpgradeService(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9"), 1))),
            new Downloader(() => throw new HttpRequestException("down")), new Verifier(true), new Installer(true),
            config, "0.1.0", "k", "windows-x86_64");
        await downloadFails.CheckAsync(manual: true);
        Assert.Equal("network_failed", (await downloadFails.InstallAsync()).Status);

        var installRefused = new UpgradeService(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9"), 1))),
            new Downloader(() => [1]), new Verifier(true), new Installer(false), config, "0.1.0", "k", "windows-x86_64");
        await installRefused.CheckAsync(manual: true);
        Assert.Equal("unavailable", (await installRefused.InstallAsync()).Status);

        var installOk = new UpgradeService(
            new Source(() => Task.FromResult(new ReleaseProbe("github", Manifest("9.9.9"), 1))),
            new Downloader(() => [1]), new Verifier(true), new Installer(true), config, "0.1.0", "k", "windows-x86_64");
        await installOk.CheckAsync(manual: true);
        Assert.Equal("installing", (await installOk.InstallAsync()).Status);
        Assert.Equal("installing", installOk.State.Status);
    }

    private static UpgradeService Build(IReleaseSource source, string pubkey, string root,
        string platform = "windows-x86_64") =>
        new(source, new Downloader(() => [1, 2, 3]), new Verifier(true), new Installer(true),
            new ConfigService(new AppPaths(Path.Combine(root, Guid.NewGuid().ToString("N")))), "0.1.0", pubkey, platform);

    private sealed class FakeHttp(Func<HttpRequestMessage, HttpResponseMessage> factory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(factory(request));
    }

    private static HttpResponseMessage Ok(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    private sealed class Source(Func<Task<ReleaseProbe>> probe) : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) => probe();
    }

    private sealed class Downloader(Func<byte[]> bytes) : IReleaseDownloader
    {
        public Task<byte[]> DownloadAsync(string url, CancellationToken ct) => Task.FromResult(bytes());
    }

    private sealed class Verifier(bool result) : IUpgradeVerifier
    {
        public bool Verify(byte[] payload, string signatureBox, string publicKeyBox) => result;
    }

    private sealed class Installer(bool result) : IUpgradeInstaller
    {
        public Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct) => Task.FromResult(result);
    }
}

/// <summary>Deep-link bounds and the argv/environment contract of every notification backend.</summary>
public class NotificationCoverageTests
{
    [Fact]
    public void DeepLinksAreBoundedAndConsumedOnce()
    {
        var queue = new DeepLinkQueue();
        Assert.Null(queue.Consume());
        Assert.False(queue.Enqueue(null));
        Assert.False(queue.Enqueue(""));
        Assert.False(queue.Enqueue("relative"));
        Assert.False(queue.Enqueue("//host/x"));
        Assert.False(queue.Enqueue("/a\\b"));
        Assert.False(queue.Enqueue("/a\nb"));
        Assert.False(queue.Enqueue("/javascript:x"));
        Assert.False(queue.Enqueue("/data:text/html,x"));
        Assert.False(queue.Enqueue("/" + new string('a', 600)));

        for (var i = 0; i < 25; i++) Assert.True(queue.Enqueue("/threads/" + i));
        Assert.Equal(20, queue.Count);          // the oldest entries were dropped
        Assert.Equal("/threads/5", queue.Consume());
    }

    [Fact]
    public async Task TheNotifierPrefersTheInAppChannelAndValidatesItsInput()
    {
        var used = 0;
        var notifier = new SystemNotifier((_, _, _) => { used++; return Task.FromResult(true); });
        Assert.Equal("missing_fields", await notifier.NotifyAsync(" ", "b", null));
        Assert.Equal("missing_fields", await notifier.NotifyAsync("t", "", null));
        Assert.Null(await notifier.NotifyAsync("t", "b", "/threads/1"));
        Assert.Equal(1, used);

        // In-app refuses, so the native path answers (stubbed: no popup in tests).
        var original = SystemNotifier.StartProcess;
        try
        {
            SystemNotifier.StartProcess = _ => null;
            used = 0;
            notifier.SetInAppHandler((_, _, _) => { used++; return Task.FromResult(false); });
            Assert.Equal("no_app", await notifier.NotifyAsync("t", "b", null));
            Assert.Equal(1, used);
        }
        finally { SystemNotifier.StartProcess = original; }
    }

    [Fact]
    public void EveryPlatformGetsItsOwnCommandAndNoneOfThemInterpolatesTheText()
    {
        const string title = "Title 'with' \"quotes\"";
        const string body = "Body; rm -rf /";

        var linux = SystemNotifier.DescribeNative(title, body, "linux")!;
        Assert.Equal("notify-send", linux.FileName);
        Assert.Equal(new[] { "--", title, body }, linux.ArgumentList.ToArray());

        var mac = SystemNotifier.DescribeNative(title, body, "macos")!;
        Assert.Equal("osascript", mac.FileName);
        Assert.Contains(title, mac.ArgumentList);
        Assert.Contains(body, mac.ArgumentList);
        Assert.DoesNotContain(mac.ArgumentList, a => a.Contains(title, StringComparison.Ordinal) && a.Contains("display notification", StringComparison.Ordinal));

        var windows = SystemNotifier.DescribeNative(title, body, "windows")!;
        Assert.Equal("powershell", windows.FileName);
        Assert.Equal(title, windows.Environment["AB_NOTIFY_TITLE"]);
        Assert.Equal(body, windows.Environment["AB_NOTIFY_BODY"]);
        Assert.DoesNotContain(windows.ArgumentList, a => a.Contains(title, StringComparison.Ordinal));

        Assert.Null(SystemNotifier.DescribeNative(title, body, "plan9"));
        Assert.NotNull(SystemNotifier.DescribeNative(title, body));
        Assert.Contains(SystemNotifier.CurrentOs(), new[] { "windows", "macos", "linux" });
    }

    [Fact]
    public async Task TheNativeLaunchReportsSuccessDenialAndAMissingClient()
    {
        var original = SystemNotifier.StartProcess;
        try
        {
            SystemNotifier.StartProcess = _ => TestProbe.Echo();
            Assert.Null(await new SystemNotifier().NotifyAsync("t", "b", null));

            SystemNotifier.StartProcess = _ => TestProbe.Failer();
            Assert.Equal("denied", await new SystemNotifier().NotifyAsync("t", "b", null));

            SystemNotifier.StartProcess = _ => null;
            Assert.Equal("no_app", await new SystemNotifier().NotifyAsync("t", "b", null));

            SystemNotifier.StartProcess = _ => throw new InvalidOperationException("no client");
            Assert.Equal("no_app", await new SystemNotifier().NotifyAsync("t", "b", null));
        }
        finally { SystemNotifier.StartProcess = original; }
    }
}

/// <summary>Tray menu mapping and the window callbacks the shell exposes.</summary>
public class ShellStateCoverageTests
{
    [Fact]
    public void TrayPathsAndBadgeNumbersCoverEveryMenuId()
    {
        Assert.Equal("/", TrayService.PathFor(TrayService.IdOpen));
        Assert.Equal(ShellEndpoints.Connect, TrayService.PathFor(TrayService.IdSettings));
        Assert.Equal(ShellEndpoints.About, TrayService.PathFor(TrayService.IdAbout));
        Assert.Equal("", TrayService.PathFor(TrayService.IdQuit));
        Assert.Equal("", TrayService.BadgeNumber(0));
        Assert.Equal("7", TrayService.BadgeNumber(7));
        Assert.Equal("99+", TrayService.BadgeNumber(100));
    }

    [Fact]
    public async Task WindowCallbacksAreOptionalAndStored()
    {
        var paths = new AppPaths(Path.Combine(Path.GetTempPath(), "ab-" + Guid.NewGuid().ToString("N")));
        var copy = new LocalizationService();
        var credentials = new CredentialStore(paths);
        var services = new ShellServices
        {
            Config = new ConfigService(paths), Copy = copy, Credentials = credentials, Tray = new TrayService(copy),
            Notifier = new SystemNotifier((_, _, _) => Task.FromResult(true)), DeepLinks = new DeepLinkQueue(),
            Executor = new ExecutorService(credentials),
            Upgrade = new UpgradeService(new NoSource(), new NoDownloader(), new NoVerifier(), new NoInstaller(),
                new ConfigService(paths), "0.1.0", ""),
            Paths = paths
        };
        Assert.Null(services.Navigate);
        Assert.Null(services.HideWindow);
        Assert.Null(services.Quit);

        services.Navigate = route => Task.CompletedTask;
        services.HideWindow = () => Task.CompletedTask;
        services.Quit = () => Task.CompletedTask;
        await services.Navigate("/");
        await services.HideWindow();
        await services.Quit();
        Assert.Equal("0.1.0", services.Version);
    }

    private sealed class NoSource : IReleaseSource
    {
        public Task<ReleaseProbe> ProbeAsync(CancellationToken ct) => Task.FromResult(new ReleaseProbe("github", "", 1, "network_failed"));
    }
    private sealed class NoDownloader : IReleaseDownloader
    {
        public Task<byte[]> DownloadAsync(string url, CancellationToken ct) => Task.FromResult(Array.Empty<byte>());
    }
    private sealed class NoVerifier : IUpgradeVerifier
    {
        public bool Verify(byte[] payload, string signatureBox, string publicKeyBox) => false;
    }
    private sealed class NoInstaller : IUpgradeInstaller
    {
        public Task<bool> InstallAsync(byte[] package, string fileName, CancellationToken ct) => Task.FromResult(false);
    }
}
