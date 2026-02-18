---
name: preen-dependency-security
description: Proactively audit dependency vulnerabilities and version hygiene, then land focused, low-risk hardening fixes.
---

# Preen Dependency Security

Proactively audit dependency risk across the monorepo by finding high/critical vulnerabilities, unsafe versioning patterns, and dependency drift that can weaken CI reliability or production security.

## When to Run

Run this skill when:

- Preen rotation selects `preen-dependency-security`
- A package update or lockfile change lands in a broad area
- CI starts failing due to dependency or transitive issues
- Security review asks for dependency hardening

## Discovery Phase

Use fast, bounded discovery commands first:

```bash
# Vulnerability signal (high/critical only)
pnpm audit --prod --audit-level high --json 2>/dev/null | head -40 || true

# Risky versioning patterns in manifests
rg -n --glob 'package.json' 'latest|next|canary|beta|\*|\^0\.' packages scripts . | head -40

# Dependency scripts that can execute at install time
rg -n --glob 'package.json' '"preinstall"|"install"|"postinstall"|"prepare"' packages . | head -40

# Workspace overrides and pinning policy hotspots
rg -n --glob 'package.json' '"overrides"|"resolutions"' . | head -20

# Outdated packages snapshot (informational)
pnpm outdated -r 2>/dev/null | head -40 || true
```

## Issue Categories

### 1. High/Critical Vulnerabilities

- Any high/critical vulnerability reachable by runtime dependencies is top priority.
- Prefer minimal-version upgrades over major jumps when possible.
- If a transitive issue cannot be upgraded directly, use `pnpm.overrides` with explicit rationale.

### 2. Unsafe Version Specifiers

- Avoid `latest`, `next`, `canary`, and broad wildcards in committed manifests.
- Pin known-stable versions for infrastructure-critical packages.
- Treat `^0.x` ranges carefully; minor bumps can be breaking in pre-1.0 packages.

### 3. Install-Time Script Risk

- Review `preinstall`/`install`/`postinstall` scripts for unnecessary privileged behavior.
- Prefer deterministic build steps in CI pipelines over implicit install-time logic.
- Keep postinstall steps scoped and auditable.

### 4. Override/Resolution Drift

- Remove stale overrides that no longer affect resolution.
- Keep overrides minimal and documented; broad overrides can mask incompatibilities.
- Validate that override changes do not regress runtime behavior.

## Prioritization

Fix in this order:

1. High/critical runtime vulnerabilities
2. Unsafe or floating version constraints in critical packages
3. Risky install-time scripts in widely used packages
4. Stale overrides / dependency hygiene cleanup

## Fix Patterns

### Patch Vulnerability with Minimal Blast Radius

```json
{
  "pnpm": {
    "overrides": {
      "vulnerable-package": "1.2.3"
    }
  }
}
```

After adding overrides, validate the impacted packages and remove overrides when upstream dependencies catch up.

### Replace Risky Version Specs

```json
{
  "dependencies": {
    "safe-lib": "4.8.2"
  }
}
```

### Validate Safety

```bash
pnpm install
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
```

Run broader checks when dependency changes are wide:

```bash
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
```

## Workflow

1. **Discovery**: Collect vulnerability and version-risk signals.
2. **Select one fix**: Choose one focused, high-confidence change.
3. **Create branch**: `git checkout -b security/dependency-<area>`
4. **Implement**: Apply the minimal safe upgrade or override.
5. **Validate**: Run impacted quality/tests, then broaden if needed.
6. **Document**: Record before/after metric (for example, high/critical count).
7. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no high-value fix is found, do not create a branch.

## Guardrails

- Do not batch unrelated dependency upgrades in a single preen run.
- Do not silently introduce major-version upgrades without explicit risk review.
- Do not leave temporary overrides without rationale.
- Do not reduce coverage thresholds.

## Quality Bar

- High/critical findings reduced for selected scope
- No new install-time script risk introduced
- Impacted quality/tests pass
- Change remains focused and reviewable

## Token Efficiency

```bash
pnpm audit --prod --audit-level high --json 2>/dev/null | head -40 || true
rg -n --glob 'package.json' 'latest|next|canary|beta|\*|\^0\.' packages scripts . | head -40
pnpm exec tsx scripts/ciImpact/runImpactedQuality.ts >/dev/null
pnpm exec tsx scripts/ciImpact/runImpactedTests.ts >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, rerun the failing command without suppression.
