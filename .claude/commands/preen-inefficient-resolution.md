---
description: Preen Inefficient Module Resolution
---

# Preen Inefficient Module Resolution

Proactively search the monorepo for inefficient module resolution patterns and eliminate them. This includes cyclical imports, empty re-exports, redundant barrel files, and convoluted import paths.

## When to Run

Run this skill when maintaining code quality or during slack time. It searches the entire codebase for module resolution improvements.

## Discovery Phase

Search all packages for module resolution issues:

```bash
# Find potential cyclical imports using madge (if installed)
npx madge --circular --extensions ts,tsx packages/ 2>/dev/null | head -30

# Find empty or near-empty index.ts files (potential empty re-exports)
find . -name "index.ts" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -exec sh -c 'lines=$(wc -l < "$1"); if [ "$lines" -lt 5 ]; then echo "$1 ($lines lines)"; fi' _ {} \; | head -20

# Find barrel files that only re-export from a single file
find . -name "index.ts" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -exec sh -c 'exports=$(grep -c "export" "$1" 2>/dev/null); sources=$(grep -o "from '\''[^'\'']*'\''" "$1" 2>/dev/null | sort -u | wc -l); if [ "$exports" -gt 0 ] && [ "$sources" -eq 1 ]; then echo "$1 (single source)"; fi' _ {} \; | head -20

# Find files importing from parent then child (../foo then ../foo/bar)
rg -n --glob '*.{ts,tsx}' "from '\\.\\./[^']*'" . | head -20

# Find deep relative imports (more than 3 levels)
rg -n --glob '*.{ts,tsx}' "from '\\.\\./\\.\\./\\.\\./\\.\\." . | head -20

# Find re-exports that just pass through (export { x } from './x')
rg -n --glob '*.{ts,tsx}' "export {.*} from '\\./[^']*'" . | head -20
```

## Issue Categories

### 1. Cyclical Imports

Modules that import each other directly or indirectly, causing:

- Runtime errors (undefined imports)
- Bundler warnings
- Hard-to-debug initialization issues

**Detection:**

```bash
npx madge --circular --extensions ts,tsx packages/
```

**Resolution strategies:**

- Extract shared types/constants to a separate module
- Use dependency injection instead of direct imports
- Restructure module boundaries
- Move the shared code to the module that is imported first

### 2. Empty Re-exports

Index files that exist only to re-export without adding value:

```typescript
// Bad: packages/foo/index.ts
export * from './foo';

// The consumer could just import directly:
// import { something } from './foo' instead of './foo/index'
```

**When to keep barrel files:**

- When re-exporting from multiple files (true aggregation)
- When providing a stable public API boundary
- When renaming exports for external consumers

**When to remove:**

- Single-file re-exports with no renaming
- Internal modules with no external consumers
- Files that just add an extra resolution step

### 3. Redundant Import Paths

Imports that go through unnecessary indirection:

```typescript
// Bad: importing through multiple barrels
import { Button } from '@/components/ui/index';
import { Button } from '@/components/ui';
import { Button } from '@/components/index';

// Better: direct import if not a public API
import { Button } from '@/components/ui/Button';
```

### 4. Deep Relative Imports

Imports with excessive `../` that make refactoring difficult:

```typescript
// Bad
import { util } from '../../../../shared/utils/string';

// Better: use path aliases
import { util } from '@/shared/utils/string';
```

### 5. Circular Type Dependencies

Types that reference each other across module boundaries:

```typescript
// user.ts
import { Post } from './post';
interface User {
  posts: Post[];
}

// post.ts
import { User } from './user';
interface Post {
  author: User;
}
```

**Resolution:**

- Use `import type` to break runtime cycles
- Extract shared types to a types module
- Use interface merging or generics

## Prioritization

Fix issues in this order (highest impact first):

1. **Runtime cyclical imports** - Cause actual bugs and undefined values
2. **Deep relative imports (4+ levels)** - Make refactoring painful
3. **Single-source barrel files** - Add unnecessary resolution steps
4. **Type-only cycles** - Lower priority since they don't affect runtime

## Workflow

1. **Discovery**: Run discovery commands to identify candidates across all packages.
2. **Selection**: Choose a category or area with high-impact issues.
3. **Create branch**: `git checkout -b refactor/module-resolution-<area>`
4. **Fix issues**: Apply resolution strategies, starting with highest impact.
5. **Validate**: Run `pnpm typecheck` and `pnpm lint` to ensure no regressions.
6. **Run tests**: Ensure all tests still pass.
7. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no high-value fixes were found during discovery, do not create a branch or run commit/merge workflows.

## Guardrails

- Do not change public API surfaces without updating consumers
- Do not remove barrel files that serve as intentional API boundaries
- Preserve `import type` distinctions when refactoring
- Keep changes focused on one category per PR
- Run the full test suite before committing
- Avoid breaking changes to external package consumers

## Quality Bar

- Zero new cyclical imports introduced
- No increase in import path depth
- All existing tests pass
- Lint and typecheck pass
- Bundle size should not increase

## PR Strategy

Use incremental PRs by category:

- PR 1: Fix cyclical imports in specific package
- PR 2: Remove empty re-exports in specific area
- PR 3: Simplify deep relative imports with path aliases
- PR 4: Clean up redundant barrel files

In each PR description, include:

- What category of issues were fixed
- Files changed and why
- Any module boundaries that were restructured
- Test evidence

## Token Efficiency

Discovery commands can return many lines. Always limit output:

```bash
# Count first, then list limited results
npx madge --circular ... 2>/dev/null | head -30
find ... | head -20

# Suppress verbose validation output
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
