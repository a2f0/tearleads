---
name: preen-typescript
description: Proactively search the monorepo for weak TypeScript typings and strengthen them by replacing `any`, narrowing `unknown`, removing unsafe `as` casts, and eliminating `@ts-ignore`/`@ts-expect-error` comments. Use when maintaining code quality or during slack time.
---


# Preen TypeScript Types

Proactively search the monorepo for weak TypeScript typings and strengthen them by replacing `any`, narrowing `unknown`, removing unsafe `as` casts, and eliminating `@ts-ignore`/`@ts-expect-error` comments.

## When to Run

Run this skill when maintaining code quality or during slack time. It searches the entire codebase for type safety improvements.

## Discovery Phase

Search all packages for files with type safety issues:

```bash
# Find files with `any` type annotations
rg -n --glob '*.{ts,tsx}' ': any|: any\[\]|<any>|as any' . | wc -l

# List specific files with `any`
rg -l --glob '*.{ts,tsx}' ': any|: any\[\]|<any>|as any' . | head -20

# Find `as` type assertions (potential unsafe casts)
rg -n --glob '*.{ts,tsx}' ' as [A-Z]' . | rg -v '\.test\.' | head -20

# Find ts-ignore and ts-expect-error comments
rg -n --glob '*.{ts,tsx}' '@ts-ignore|@ts-expect-error' . | head -20

# Find `unknown` that might need narrowing
rg -n --glob '*.{ts,tsx}' ': unknown' . | head -20
```

## Prioritization

Fix issues in this order (highest impact first):

1. **`any` in function signatures** - Parameters and return types affect all callers
2. **`any` in exported interfaces/types** - Affects consuming code across the codebase
3. **`as` casts that bypass type checking** - Often hide real bugs
4. **`@ts-ignore`/`@ts-expect-error`** - Usually indicate underlying issues
5. **`any` in local variables** - Lower impact but still worth fixing
6. **`unknown` that needs narrowing** - Usually safe but could be more precise

## Replacement Strategies

### Replacing `any`

1. **Infer from usage**: Look at how the value is used to determine the correct type
2. **Use generics**: Replace `any` with type parameters when the type varies
3. **Use union types**: When a value can be one of several known types
4. **Use `unknown`**: When the type is truly unknown at compile time (then narrow it)

```typescript
// Before
function process(data: any): any { ... }

// After - with proper types
function process(data: UserInput): ProcessedResult { ... }

// After - with generics
function process<T extends BaseData>(data: T): ProcessedData<T> { ... }
```

### Replacing `as` Casts

1. **Use type guards**: Write functions that narrow types safely

```typescript
// Before
const user = response.data as User;

// After - with type guard
function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.email === 'string'
  );
}

if (isUser(response.data)) {
  const user = response.data; // Type is narrowed to User
}
```

1. **Use assertion functions**: For cases where you want to throw on invalid data

```typescript
function assertIsUser(value: unknown): asserts value is User {
  if (!isUser(value)) {
    throw new Error('Expected User object');
  }
}
```

1. **Fix the source**: Often the upstream type is wrong and should be fixed there

### Eliminating `@ts-ignore` / `@ts-expect-error`

1. **Fix the actual type error**: Usually the right solution
2. **Update type definitions**: If the types are wrong
3. **Add proper overloads**: If the function signature is incomplete
4. **Use type assertions as last resort**: With a comment explaining why

```typescript
// Before
// @ts-ignore - TODO fix this
const result = someFunction(data);

// After - fix the root cause
const result = someFunction(data as ExpectedType); // Temporary: upstream types are incorrect, see issue #123
```

### Narrowing `unknown`

Use type guards, `typeof`, `instanceof`, or discriminated unions:

```typescript
// Before
function handle(error: unknown) {
  console.log(error.message); // Error: 'unknown' has no property 'message'
}

// After
function handle(error: unknown) {
  if (error instanceof Error) {
    console.log(error.message);
  } else if (typeof error === 'string') {
    console.log(error);
  } else {
    console.log('Unknown error:', String(error));
  }
}
```

### Validating Network/Storage Data

Always validate data from external sources (SSE, WebSocket, Redis, localStorage):

```typescript
// Before - trusting external data
const parsed = JSON.parse(data) as StoredUser;

// After - validate before use
interface StoredUser {
  id: string;
  email: string;
}

function isStoredUser(value: unknown): value is StoredUser {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['email'] === 'string'
  );
}

const parsed: unknown = JSON.parse(data);
if (!isStoredUser(parsed)) {
  return null; // or throw
}
// parsed is now safely typed as StoredUser
```

### Cleaner Global Type Access

Use `globalThis` with a typed intersection instead of `window as unknown as {...}`:

```typescript
// Before - verbose and uses `unknown`
const handlers = (
  window as unknown as {
    __messageHandler?: Map<string, (msg: Message) => void>;
  }
).__messageHandler;

// After - cleaner with globalThis
type MessageHandlerRegistry = Map<string, (msg: Message) => void>;

const handlers = (
  globalThis as { __messageHandler?: MessageHandlerRegistry }
).__messageHandler;
```

## Type Guard Patterns

Place type guards in a shared location when used across files:

```text
packages/shared/src/typeGuards/
  user.ts          # isUser, assertIsUser
  api.ts           # isApiResponse, isApiError
  index.ts         # Re-exports
```

### Standard Type Guard Template

```typescript
export function isTypeName(value: unknown): value is TypeName {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.requiredField === 'string' &&
    (obj.optionalField === undefined || typeof obj.optionalField === 'number')
  );
}

export function assertIsTypeName(value: unknown): asserts value is TypeName {
  if (!isTypeName(value)) {
    throw new TypeError(`Expected TypeName, got: ${JSON.stringify(value)}`);
  }
}
```

## Workflow

1. **Discovery**: Run discovery commands to identify candidates across all packages.
2. **Selection**: Choose a file or category with high-impact type issues.
3. **Create branch**: `git checkout -b refactor/typescript-<area>`
4. **Fix types**: Apply replacement strategies, starting with highest impact.
5. **Add type guards**: Create reusable type guards for complex types.
6. **Validate**: Run `pnpm typecheck` and `pnpm lint` to ensure no regressions.
7. **Run tests**: Ensure all tests still pass.
8. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

If no high-value fixes were found during discovery, do not create a branch or run commit/merge workflows.

## Guardrails

- Do not change runtime behavior unless fixing a bug
- Do not introduce new `any`, `as`, or `@ts-ignore`
- Prefer gradual improvement over big-bang rewrites
- Keep PRs focused on one area or pattern
- Add tests for new type guards
- Document non-obvious type decisions with comments

## Quality Bar

- Zero new `any` types introduced
- All type guards have corresponding tests
- No regression in type coverage
- All existing tests pass
- Lint and typecheck pass

## PR Strategy

Use incremental PRs by category:

- PR 1: Fix `any` in shared types/interfaces
- PR 2: Add type guards for API responses
- PR 3: Remove `as` casts in specific feature area
- PR 4: Eliminate `@ts-ignore` comments

In each PR description, include:

- What category of type issues were fixed
- Files changed and why
- Any new type guards added
- Test evidence

## Token Efficiency

Discovery commands can return many lines. Always limit output:

```bash
# Count first, then list limited results
rg -l ... | wc -l                 # Get count
rg -l ... | head -20              # Then sample

# Suppress verbose validation output
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
