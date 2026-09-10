---
name: run-code-ql-scan
description: Run CodeQL locally on Tearleads JavaScript/TypeScript, review the alerts in context, and report findings with source links and saved SARIF results. Use for a requested CodeQL scan or evaluation without CI.
---

# Run CodeQL Scan

Run the default JavaScript/TypeScript security suite locally, then explain the
findings as a code review. Keep the original SARIF and a readable report outside
the checkout. A scan alone does not authorize code fixes, CI changes, or uploads;
include those only when the user also requests them.

## Scope and tooling

- By default, scan the current committed `HEAD`. State the revision and report
  any uncommitted work excluded from the scan. Honor a requested revision.
- If the user requests uncommitted code, snapshot the current tracked and
  non-ignored untracked source files outside the checkout instead of using
  `git archive` below. Omit deleted files, dependencies, and generated output;
  record the base SHA and dirty paths, and label the result a working-tree scan.
  Do not stash, switch branches, or commit just to run a scan.
- Reuse `CODEQL_CLI` when provided, otherwise look for `codeql` on `PATH` or an
  existing bundle under `~/.local/share/codeql/<version>/codeql/codeql`.
  Set `CODEQL_CLI` to the executable's absolute path and verify it with
  `"$CODEQL_CLI" version`.
- If missing, install the latest stable official **CodeQL bundle**, including
  its matching precompiled queries, outside the repo. Select the platform asset
  from [CodeQL bundle releases](https://github.com/github/codeql-action/releases),
  download its checksum file, and verify SHA-256 before extraction. Use GitHub's
  [CLI setup instructions](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-the-command-line/set-up-codeql-cli).
  On Apple Silicon, check Xcode command-line tools and Rosetta availability.
- TypeScript extraction requires Node on `PATH`. It does not require a Bun
  application build. Keep tests and tooling in the initial scan, so their
  findings can be classified rather than hidden by broad exclusions.

## Run the scan

Use a fresh external directory for each run. The example assumes `CODEQL_CLI`
has been resolved and scans committed source; `SCAN_REF` can select a revision.
Run it in a shell that stops on failed commands, and retain logs on failure.

```sh
set -e
SCAN_ROOT=$(git rev-parse --show-toplevel)
SCAN_SHA=$(git -C "$SCAN_ROOT" rev-parse --verify "${SCAN_REF:-HEAD}^{commit}")
mkdir -p "$HOME/codeql-reports"
SCAN_DIR=$(mktemp -d "$HOME/codeql-reports/tearleads-codeql.XXXXXX")
mkdir "$SCAN_DIR/source"
git -C "$SCAN_ROOT" status --short > "$SCAN_DIR/worktree-status.txt"
git -C "$SCAN_ROOT" archive --output="$SCAN_DIR/source.tar" "$SCAN_SHA"
tar -xf "$SCAN_DIR/source.tar" -C "$SCAN_DIR/source"
rm "$SCAN_DIR/source.tar"
printf '%s\n' "$SCAN_SHA" > "$SCAN_DIR/commit.txt"
"$CODEQL_CLI" version --format=json > "$SCAN_DIR/codeql-version.json"
"$CODEQL_CLI" resolve packs --format=json > "$SCAN_DIR/packs.json"
SCAN_SUITE=codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls
"$CODEQL_CLI" resolve queries "$SCAN_SUITE" --format=json \
  > "$SCAN_DIR/queries.json"
SCAN_STARTED=$(date +%s)
if ! "$CODEQL_CLI" database create "$SCAN_DIR/database" \
  --language=javascript-typescript --source-root="$SCAN_DIR/source" \
  --threads=4 --ram=8192 > "$SCAN_DIR/extract.log" 2>&1; then
  tail -40 "$SCAN_DIR/extract.log"
  printf 'Extraction failed; artifacts: %s\n' "$SCAN_DIR"
  exit 1
fi
SCAN_EXTRACTED=$(date +%s)
if ! "$CODEQL_CLI" database analyze "$SCAN_DIR/database" "$SCAN_SUITE" \
  --format=sarif-latest --output="$SCAN_DIR/results.sarif" \
  --sarif-add-snippets --sarif-include-query-help=always \
  --threads=4 --ram=8192 > "$SCAN_DIR/analyze.log" 2>&1; then
  tail -40 "$SCAN_DIR/analyze.log"
  printf 'Analysis failed; artifacts: %s\n' "$SCAN_DIR"
  exit 1
fi
SCAN_FINISHED=$(date +%s)
printf 'extraction_seconds=%s\nanalysis_seconds=%s\n' \
  "$((SCAN_EXTRACTED - SCAN_STARTED))" "$((SCAN_FINISHED - SCAN_EXTRACTED))" \
  > "$SCAN_DIR/timing.txt"
printf 'CodeQL artifacts: %s\n' "$SCAN_DIR"
```

The memory/thread values suit a 32 GiB workstation; reduce them on smaller
machines. Record the actual commands and resources used. Installation time is
separate from extraction and analysis time. Continue checking scan progress and
sharing updates while commands run.

If extraction or analysis fails, diagnose the failure before drawing conclusions.
An incomplete scan or missing SARIF file is not a clean result. Preserve the logs
and report the stage reached if the tool cannot complete.

## Review and report

Read `results.sarif` programmatically. For each run, resolve result rules against
`tool.driver.rules` or the referenced `tool.extensions` component. Preserve:

- Rule ID, description, `properties.security-severity`, and result message.
- Source path and complete start/end region, with nearby source context.
- Related locations and each separate `codeFlows[].threadFlows[]` path. Do not
  concatenate independent paths into one trace.
- Tool warnings/errors and extraction coverage from diagnostics and logs.

CodeQL's severity score describes the rule; it does not confirm exploitability
in this application. Inspect the **scanned source snapshot**, callers, and
consumers for every alert. Classify each as actionable, a likely false positive,
or requiring further investigation, and state the evidence. Test bookkeeping
is different from a production security boundary; metadata extraction is
different from inserting HTML. Do not dismiss all tests or all configuration
inputs automatically.

When a performance alert needs verification, use bounded local probes of the
flagged operation. Record runtime, input size, and timings; distinguish a
reproduced slowdown from proof that an attacker can supply the input. Avoid
network requests or opening real databases for these probes.

Write `report.md` under `SCAN_DIR`, with an optional standalone `report.html` for
browsing longer traces. Include the revision/snapshot scope, CLI and query-pack
versions, query/file counts, timings, all raw alerts with review notes, and
reproduction commands. Keep `results.sarif` unchanged. Check that report counts
match SARIF and that local artifact links resolve.

File extraction coverage is not proof of complete framework data-flow coverage.
For stack-specific claims, inspect the installed query pack and current
[framework support](https://codeql.github.com/docs/codeql-overview/supported-languages-and-frameworks/).
Do not treat a clean scan as validation of authorization or cryptographic protocol
invariants, or of languages not scanned. Do not carry forward a prior scan's
false-positive decisions without checking the current source.

Finish by printing a concise summary like:

- Scan scope, query/file counts, and extraction + analysis runtime.
- Links to the readable report and original SARIF.
- A table grouping the findings and their reviewed significance.
- Material coverage limits and a recommendation grounded in this run.

When verifying fixes, compare by rule and code location/behavior, allowing for
line shifts. State which prior findings disappeared and which remain.
