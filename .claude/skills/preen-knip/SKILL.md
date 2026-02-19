---
name: preen-knip
description: Proactively reduce knip findings by removing unused dependencies, exports, and files in coherent, low-risk slices. Use when maintaining code quality or during slack time.
---

# Preen Knip

Proactively reduce knip findings by removing unused dependencies, exports, and files in coherent, low-risk slices.

## When to Run

Run this skill when maintaining code quality or during slack time, especially when the codebase has accumulated knip noise.

## Discovery Phase

Capture a baseline of current findings:

```bash
pnpm exec knip --config knip.json --use-tsconfig-files --reporter compact || true
```

For machine-readable scoring/counting:

```bash
KNIP_JSON=$(mktemp)
pnpm exec knip --config knip.json --use-tsconfig-files --reporter json > "$KNIP_JSON" 2>/dev/null || true
jq '[
  .issues[]? |
  (.dependencies // []),
  (.devDependencies // []),
  (.unlisted // []),
  (.unresolved // []),
  (.exports // []),
  (.types // [])
] | flatten | length' "$KNIP_JSON"
rm -f "$KNIP_JSON"
```

## Slice Selection

Choose one coherent slice per run. Prefer macro slices over micro edits:

1. One package/domain group at a time (for example `packages/ui` + `packages/wallet`)

1. Low behavior risk changes first:

   - remove clearly unused exports or dead files
   - remove clearly unused dependencies after usage verification

1. Avoid mixed concerns (do not combine unrelated refactors)

## Change Rules

- Verify each candidate before deleting/removing (search for usage with `rg`)
- Preserve public API ergonomics when needed (for example exported props/types for public components)
- Do not add `any`, unsafe casts, or `@ts-ignore`
- Keep changes behavior-preserving and test-backed

## Validation

Run at least impacted checks for touched packages:

```bash
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
```

If a package has direct build/test scripts, run those too for faster local confidence.

Re-measure knip findings after edits using the same baseline command.

## Quality Gate

Only proceed when measured knip findings decrease for the selected slice:

```bash
# baseline_count captured before edits
# after_count captured after edits
[ "$after_count" -lt "$baseline_count" ]
```

## Deliverable

- One focused PR per slice
- Clear summary of removed findings
- Enter merge queue and monitor to merge before starting the next slice
