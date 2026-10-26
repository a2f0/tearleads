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
tests and is included in `check:fast`; live evaluations remain opt-in.

## Install and start

The native installer currently supports **macOS arm64**. It requires Bun from
this repository, Node 22 or newer, npm, pnpm, Git, Python 3.12 or newer,
`redis-server`, Claude Code, and Codex on `PATH`. Scope's own `packageManager`
field selects its pinned pnpm version. The host agent CLIs are supplied by the
operator; their versions are recorded rather than installed by this command.

Sign in to Claude Code and run `codex login` using ChatGPT authentication first.
This adapter reads Claude's `~/.claude/.credentials.json` OAuth login at worker
startup. Refresh that login and restart if it expires. Codex uses its saved
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
are pinned; their transitive npm dependencies resolve at installation time.
No upstream source patches or dependency symlinks into this repository are used.

The stack binds services to loopback and disables application authentication.
It is a development stack for trusted source on your machine. The native Claude
worker runs outside a container with host access and upstream Scope owns
`/tmp/workspaces`; run only one native worker on the host. Startup refuses a
nonempty existing workspace directory. Do not put unrelated work there.

The Codex Judge runs with a read-only sandbox and no approval prompts, checks
only local emulator artifact URLs, rejects archive links and escaping paths,
and validates every requested verdict. These controls do not turn the native
coding worker into an isolation boundary.

## Run the discoverability baseline

Registration uploads **committed source only**, using `git archive`. Uncommitted
edits, ignored files, dependencies and credentials are excluded. Re-register
after committing a change that you want to measure; a git ref may be supplied.

```sh
bun run scope:register HEAD
bun run agent:run --label scope-calibrate -- bun run scope calibrate
bun run agent:run --label scope-baseline -- bun run scope benchmark
```

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
Raw Judge evidence stays under `.scope/judge/evaluations/`. Inspect failures to
distinguish repository friction from agent mistakes and environment failures.
If polling times out, the request may remain active: inspect its link before
submitting again. A failed evaluation is a finding; an infrastructure error
stops the remaining batch.

Keep a small reviewed findings document in Git when comparing repository
improvements. Keep full transcripts and large snapshots in `.scope/`. For a
controlled comparison, hold task definitions, agent/model, Judge, iteration
budget and environment constant, then change one repository condition.

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
