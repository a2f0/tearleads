---
name: performance-pass
description: Make a page or embedded viewer load faster without changing what it shows, in measured rounds that each ship through ship-pr, then carry the release to every consumer. Use when the user asks to speed up loading, startup, or first render, or to dogfood a performance round; not for changing visual quality, content, or features.
---

# Performance Pass

A pass is a few rounds. Each round measures, changes one thing, proves the
output is unchanged, measures again, and ships. Numbers decide what lands;
impressions do not. What the page shows is fixed: a faster load that changes a
pixel, a mesh, or a behaviour is a regression, not a win.

## The measuring command

`agent-tool perf` runs the measurements; run the repository's pinned
agent-tool (`bun run agent-tool perf` or `node_modules/.bin/agent-tool perf`).
It drives Chrome through the measured repository's own `playwright`, found
from the working directory or `--from <directory>` inside the checkout it
runs in, and never fetches one.
From a matrix workspace, measure a checkout with
`agent-tool perf <command> --from checkouts/<name>`. If the pinned agent-tool
predates the command, run `bunx --bun @a2f0/agent-tool@latest perf`.

| Command | Does |
| --- | --- |
| `serve <dir> [--port N] [--http1]` | Serves a production build over HTTP/2 with gzip (compressed before the first request) and ETag revalidation, as a CDN does, never following links out of the directory. Start it with `agent-tool proc start --label serve -- node_modules/.bin/agent-tool perf serve <dir>` and stop it with `agent-tool proc stop`. |
| `measure <url> --ready <js>` | Cold, cache-disabled loads timed from the start of navigation (it waits only for the commit, never the `load` event); prints the median time until the `--ready` expression is true, requests, bytes, when the finished requests ended, and how many were still pending. `--waterfall` lists requests; `--profile` adds CPU self and inclusive times from an extra, unsampled run; `--json` prints the report as JSON. |
| `shot <url> --ready <js> --out <png>` | Screenshot of the ready state with a seeded `Math.random`, for fidelity diffs. `--eval <js>` runs an interaction first (switch a mode on); `--hide <css>` hides random decoration, reaching into open shadow roots. |
| `diff <a.png> <b.png>` | Counts differing pixels, and the busiest 50-pixel cells, without a browser; exits 1 on any. |
| `graph <dir> <entry...> [--out <file>]` | Relative static and dynamic import closure of ES modules, as JSON. |

Defaults: 5 runs, 40 ms latency, 20 Mbps, no CPU slowdown, 1600x900. Always
also measure a slow profile, `--latency 150 --mbps 5 --cpu 4`, since a
phone's CPU, not the network, is often what remains.

## Procedure

1. Scope. Name the pages, the ready signal (what "usable" means: first frame
   drawn, `aria-busy` cleared, a hydration flag), and every consumer that
   embeds the package. Read each repository's guidance first; it decides
   validation, versioning, and shipping.
2. Baseline. Build the production output from the base commit into a scratch
   copy (`git archive <base> | tar -x -C <dir>`, link `node_modules`), serve
   it, and measure both profiles with `--waterfall --profile`. Check the live
   deployment's headers with `curl -sSI -H 'Accept-Encoding: br, gzip'`
   (compression, `cache-control`, HTTP version): local serving only stands in
   for them.
3. Read the time. Split ready time into network (request chain depth, bytes,
   queueing) and main thread (the CPU profile's inclusive table). A waterfall
   whose requests start in steps is a dependency chain; a long tail after
   `network done` is CPU.
4. Choose one change, safest first:
   - Transport: preload hints for a known module graph, fewer chained
     requests, compression, cache headers. Output cannot change.
   - Deferral: build what the first frame does not show (hidden modes, unused
     layers) on first use instead of at startup. The first frame must be
     identical, and the deferred feature must still work when first used.
   - Same-output speedups: faster algorithms, fewer allocations, typed arrays,
     reused buffers. Prove byte-identical output (geometry arrays, generated
     files), not just "looks the same".
   - Never, unless the user asks: lower resolution, level of detail,
     sampling, lossy re-encoding, removing content, or changing a bundler or
     vendored engine against repository guidance.
5. Prove fidelity. Run the repository's own pixel, geometry, and browser
   suites, and `shot` + `diff` the ready state of base and change at the same
   viewport. First diff two base shots against each other: if the page is
   not deterministic even when seeded, say which regions vary and compare
   with that in mind, never by loosening the repository's own thresholds.
6. Measure again with the same commands and runs. Keep the change only when
   both medians improve beyond the base's own min-max spread; report both
   profiles' before and after medians and network-done times.
7. Ship with `ship-pr` in that repository, the measurements in the PR body.
   Then, for each consumer, bump to the published version with its own
   `ship-pr`, and measure the consumer's page the same way when it can be
   served locally.
8. Learn. Repository-specific findings (what dominated, what was tried and
   rejected and why) go in that repository's agent guidance or skill.
   Cross-repository lessons go in agent-tool's
   `skills/performance-pass/references/lessons.md`, by PR there. Next round
   starts from step 3 with the new profile.

## Pitfalls

- Serve over HTTP/2. Browsers open six HTTP/1.1 connections per host, so a
  plain local server queues a module graph that a CDN serves at once, and
  makes preload changes look worthless.
- Compress once per file, not per request: a server compressing on every
  request adds its own CPU time to the waterfall.
- Preload links that hosts' pages receive must go in the document head (not
  a shadow root) and should be removed once loading settles; skip assets a
  host replaces, such as a shared engine.
- Medians of one or two runs are noise; run at least five, seven for a
  close call. Check `uptime` first: other sessions' test suites inflate the
  CPU-throttled profile most. Under load, interleave base and change runs,
  and back a CPU change with `--profile`, comparing the changed function's
  inclusive time against what remains, rather than wall medians alone.
- Deferring work is only output-neutral if nothing the deferred work reads
  changes before it runs. Find every writer of its inputs and make it run
  before the first one, then test a deferred instance against an eager one
  step by step.

## Ownership

agent-tool (`a2f0/agent-tool`) owns this skill at `skills/performance-pass/`
and the command at `src/perf/`, with its tests beside it; `agent-tool skills
install --apply` installs it in each adopting repository. Change it there,
never in an installed copy.
