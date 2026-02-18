---
name: preen-package-docs
description: Audit and generate missing package README.md files
---


# Preen Package Documentation

Proactively audit the `packages/` directory for missing or incomplete README.md files and ensure all packages have proper documentation.

## When to Run

Run this skill when maintaining package documentation quality or during slack time. It ensures all packages in the monorepo have consistent, useful README files.

## Package README Structure

Each package should have a `README.md` with:

```text
packages/<name>/
  README.md          # Package documentation
  package.json       # Package metadata (source of truth for name/description)
  src/               # Source code
```

### README Template

````markdown
# @tearleads/<package-name>

<description from package.json>

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import { ... } from '@tearleads/<package-name>';
```

## Development

```bash
# Build
pnpm --filter @tearleads/<package-name> build

# Test
pnpm --filter @tearleads/<package-name> test

# Test with coverage
pnpm --filter @tearleads/<package-name> test:coverage
```

## Exports

<list key exports from src/index.ts>
````

## Discovery Phase

Search for packages missing README.md:

```bash
# List all packages and their README status
echo "=== Package README Audit ==="
for pkg in packages/*/; do
  name=$(basename "$pkg")
  if [ -f "${pkg}README.md" ]; then
    lines=$(wc -l < "${pkg}README.md" | tr -d ' ')
    echo "  [OK] $name ($lines lines)"
  else
    echo "  [MISSING] $name"
  fi
done

# Count summary
total=$(ls -d packages/*/ | wc -l | tr -d ' ')
with_readme=$(ls packages/*/README.md 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Summary: $with_readme/$total packages have READMEs"

# List packages needing READMEs
echo ""
echo "=== Packages needing README ==="
for pkg in packages/*/; do
  [ ! -f "${pkg}README.md" ] && basename "$pkg"
done
```

## Prioritization

Fix packages in this order (highest value first):

1. **Core packages**: `db`, `shared`, `ui`, `window-manager` - widely used across the monorepo
2. **Feature packages**: `audio`, `notes`, `contacts`, `calendar`, `mls-chat` - user-facing features
3. **Infrastructure packages**: `msw`, `db-test-utils`, `sync` - developer tooling
4. **Application packages**: `client`, `admin`, `website` - deployment targets

## Creating README Files

For each missing README, gather information from:

1. `package.json` - name, description, scripts
2. `src/index.ts` - exported symbols
3. Existing code patterns - usage examples

### Quick README Generation

```bash
# Get package info
PKG="<package-name>"
jq -r '.description // "No description"' packages/$PKG/package.json

# Get exports (if index.ts exists)
head -50 packages/$PKG/src/index.ts 2>/dev/null | grep -E '^export'

# Check for special build commands
jq -r '.scripts | keys[]' packages/$PKG/package.json
```

### Source-Consumed vs Built Packages

Some packages are source-consumed via Vite aliases rather than built:

```bash
# Check if package is source-consumed
grep -l "source-consumed" packages/*/package.json | xargs -I{} dirname {} | xargs -I{} basename {}
```

For source-consumed packages, note this in the README:

```markdown
## Note

This package is source-consumed via Vite aliases and does not require a separate build step.
```

## Workflow

1. **Discovery**: Run discovery commands to identify missing READMEs
2. **Selection**: Choose highest-priority package without README
3. **Create branch**: `git checkout -b docs/<package>-readme`
4. **Gather info**: Read package.json and src/index.ts
5. **Create README**: Follow template structure
6. **Validate**: Ensure README accurately describes the package
7. **Commit and merge**: Commit changes and open a PR

For bulk README generation, create multiple READMEs in a single PR:

```bash
git checkout -b docs/package-readmes
# Create READMEs for multiple packages
# Commit with: docs(packages): add missing README files
```

## Guardrails

- Do not create placeholder READMEs - each must have real, useful content
- Description must match or enhance package.json description
- Usage examples should be accurate and tested
- Do not include internal implementation details in public docs
- Keep READMEs concise - aim for 20-50 lines

## Quality Bar

- All packages have README.md files
- Each README has: title, description, usage section, development commands
- No broken links or references
- Exports section reflects actual public API

## Metric Function

```bash
# Count packages missing README.md
missing_readme_count() {
  count=0
  for pkg in packages/*/; do
    [ ! -f "${pkg}README.md" ] && count=$((count + 1))
  done
  echo $count
}

missing_readme_count
```

## Token Efficiency

When generating multiple READMEs, batch operations:

```bash
# Get all package info at once
for pkg in packages/*/; do
  name=$(basename "$pkg")
  [ ! -f "${pkg}README.md" ] && echo "=== $name ===" && jq '{name, description}' "${pkg}package.json"
done
```
