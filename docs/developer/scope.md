# Local Scope evaluations

[Microsoft Scope](https://microsoft.github.io/scope/) runs agents against fixed
repository snapshots and evaluates their results. Here we use it to investigate
**repository discoverability**: whether an agent can find the instructions,
implementation boundaries, and public APIs needed to work on Tearleads.

A passing task is evidence about that task, agent, and environment. It is not an
aggregate agent-friendliness score. The initial suite uses inspection tasks;
it does not test a clean install, compilation, or bug-fix quality.

## Tracked tooling and local state

| Location | Contents |
| --- | --- |
| `scripts/dev/scope.ts` | Repository command entrypoint |
| `scripts/dev/scope/pins.json` | Scope revision, tool versions, model and local ports |
| `scripts/dev/scope/*.py`, `loopback.cjs` | Native installation and service lifecycle |
| `scripts/dev/scope/judge/` | Codex CLI Judge adapter and verdict validation tests |
| `scripts/dev/scope/benchmarks/` | Versioned prompts and evaluation criteria |
| `.scope/` (ignored) | Registration IDs, databases, downloads, logs, PIDs, snapshots and receipts |
| `~/.local/share/scope/source` | Pinned upstream Scope checkout and its dependencies |
| Host CLI login stores | Claude Code and Codex authentication; never committed |

Application source does not depend on Scope. Development dependencies support
artifact handling and schema validation. `bun run test:scope` runs offline unit
tests using Bun and Git and is included in `check:fast`. Native integration tests
run separately with `bun run test:scope:native` and require Node and Python from
the installation prerequisites below. Live evaluations remain opt-in.

## Install and start

The native installer currently supports **macOS arm64**. It requires Bun from
this repository, Node 22 or newer, npm, pnpm, Git, Python 3.12 or newer,
`redis-server`, Claude Code, and Codex on `PATH`. Scope's own `packageManager`
field selects its pinned pnpm version. The host agent CLIs are supplied by the
operator; their versions are recorded rather than installed by this command.

Sign in to Claude Code and run `codex login` using ChatGPT authentication first.
This adapter accepts `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), or
reads Claude's `~/.claude/.credentials.json` OAuth login at worker startup.
Use the explicit token when the host login is stored only in the Keychain.
Refresh that login and restart if it expires. Codex uses its saved
ChatGPT login; the Judge does not require Copilot SDK authentication or an
OpenAI API key. Subscription access and available models still apply.

```sh
bun install
bun run agent:run --label scope-install -- bun run scope install
bun run agent:run --label scope-start -- bun run scope start
bun run scope:register
bun run scope portal
```

The last command runs the portal in the foreground at
[127.0.0.1:5100](http://127.0.0.1:5100). The API is on port 3101 and the Judge on
3201. Service ports are listed in `pins.json`. Background services write logs
and PID records to `.scope/runtime/`; stop them with `bun run scope stop`.
Stop the foreground portal separately. Partial startup failures retain PID
records so `stop` can clean up before retrying.

`install` verifies the upstream commit and refuses to change a dirty or different
checkout. Set `SCOPE_SOURCE_DIR` to use another location, consistently for all
commands. MongoDB downloads have a pinned SHA-256 checksum. Runtime tool versions
are pinned; their transitive npm dependencies resolve at installation time,
with lifecycle scripts disabled for the separate native tools installation.
No upstream source patches or dependency symlinks into this repository are used.

The stack binds services to loopback, verifies their actual listening sockets,
and disables application authentication. HTTP services and the portal reject
unexpected Host headers, cross-site browser requests, and Origins other than
their own address or the exact local portal. The Judge also requires JSON.
These guards run before upstream request and WebSocket handlers: loopback alone
does not prevent a malicious website from reaching an unauthenticated API via
CORS or DNS rebinding. Open the portal using its `127.0.0.1` URL.
Services inherit only a small set of
host environment variables; only the worker receives the Claude OAuth token.
It is a development stack for trusted source on your machine. The native Claude
worker runs outside a container with host access and upstream Scope owns
`/tmp/workspaces`; run only one native worker on the host. Startup refuses a
nonempty existing workspace directory. Do not put unrelated work there.
If a failed run leaves a workspace there, stop Scope, confirm its path against
the worker log, and move that run's directory into `.scope/` before restarting.
The launcher deliberately does not delete unknown workspaces.

The Codex Judge runs with a read-only sandbox and no approval prompts, checks
only local emulator artifact URLs, rejects archive links and escaping paths,
and validates every requested verdict. These controls do not turn the native
coding worker into an isolation boundary. The Judge's read-only mode limits
writes; it is not a host-file confidentiality boundary. Treat both agents as
processes with host-file visibility. Captured textual evidence redacts common
token fields and provider-token formats before grading, but this is best-effort
hygiene and does not sanitize arbitrary secrets embedded in source snapshots.

## Run the discoverability baseline

Registration uploads a **clean checkout of committed source**, with fresh Git
metadata and bounded history connecting the source and base commits. It pins
the base as `origin/main` inside the snapshot, regardless of the supplied base
ref's name. Both refs must resolve locally and have a common ancestor. Fetch
the intended base first; registration does not fetch from the network.

Local edits, ignored files, installed dependencies, host Git configuration,
credentials, hooks and object alternates are excluded. Only committed files
and the required Git objects enter the archive. Re-register after committing a
change that you want to measure. Defaults are `HEAD` and local `origin/main`;
pass exact commits to reproduce an older comparison.

```sh
bun run scope:register HEAD origin/main
bun run agent:run --label scope-calibrate -- bun run scope calibrate
bun run agent:run --label scope-baseline -- bun run scope benchmark
```

New registrations record both commit IDs in `.scope/config.json`. The initial
pilot's source-only archive remains historical evidence. Git-capable snapshots
remove that harness limitation, but the inspection suite still does not install
tools or run builds. The Judge rejects symlinks in result archives, including
links generated under `node_modules/.bin`; an execution harness must exclude
installed dependencies when packaging its grading evidence.
Future execution tasks must explicitly review mise trust
and provision the [verification prerequisites](verification.md#prerequisites).

Calibration sends a known correct report and a deliberately incorrect report
to the Judge against source evidence. It expects 4/4 and 1/4 criteria to pass,
respectively, and an unknown criterion to produce an error. The incorrect
report passes only the criterion checking that a report exists. Calibration
is separate from the repository benchmark and does not create dashboard runs.

`benchmark` submits these cases sequentially, with one iteration per case:

1. **Setup and verification discovery:** find supported setup and focused API
   checks, including the SDK build prerequisite and the remaining static gates.
2. **Architecture navigation:** trace document creation through actual API,
   SDK, and app code, respecting public boundaries.
3. **Public SDK onboarding:** write a minimal documented example that configures
   an assumed SQLite runtime before creating an identity and root container.

Each task writes `agent-readiness.md` with citations and a friction section.
The two criteria per task score observable report contents. They do not claim
that the commands or example executed. The coder is instructed not to inspect
the benchmark definitions, but those definitions are public in the snapshot;
this is an onboarding probe, not a hidden-answer competition.

A single trial per task is a pilot. Use `bun run scope benchmark 3` for three
trials per case when assessing variability. The pinned Judge model is in
`pins.json`; `CODEX_JUDGE_MODEL` overrides it for local experiments. The coder
uses its provider default, so record the actual model from its session evidence
before comparing runs across dates. Changing a prompt or criterion requires a
new versioned ID: seeding refuses to silently overwrite existing definitions.

Receipts under `.scope/benchmarks/` record the source commit, tooling commit,
suite definitions, run links, agent version, timings, reports and verdicts.
Raw Judge evidence stays under `.scope/judge/evaluations/`. The native adapter
uses Scope's workspace/session IDs to attach tool calls and results from the
matching host Claude session. It excludes reasoning content and other sessions.
If that session file is unavailable, only truncated Scope tool events may remain;
missing execution evidence cannot establish a passing execution criterion.
Inspect failures to
distinguish repository friction from agent mistakes and environment failures.
If polling times out, the request may remain active: inspect its link before
submitting again. A failed evaluation is a finding; an infrastructure error
stops the remaining batch.

Keep a small reviewed findings document in Git when comparing repository
improvements. Keep full transcripts and large snapshots in `.scope/`. For a
controlled comparison, hold task definitions, agent/model, Judge, iteration
budget and environment constant, then change one repository condition.

See the [initial discoverability findings](scope-baseline.md) for the first
pilot, its environment limitations, and the proposed comparison.

Completed one-iteration outputs can be regraded after a Judge integration fix:

```sh
bun run scope regrade .scope/benchmarks/<run-directory>/receipt.json
```

This writes a separate receipt under `.scope/regrades/` and preserves the
original portal grades. It invokes the Judge again without rerunning the coder.
Keep the original and corrected grades together when reporting a baseline.

## Other commands

```sh
bun run scope --help
bun run scope smoke
bun run scope run list
bun run scope cli --help
bun run scope stop
```

`smoke` runs a four-criterion repository inspection through the same tracked
Judge. Historical unscored runs can show 100% merely because the worker
completed; exclude them from conclusions. The portal's aggregate rate also
mixes unlike tasks, so open individual runs and inspect their criteria.
