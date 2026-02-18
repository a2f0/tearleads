# TypeScript Standards

## Required

- **Explicit types** for function parameters and return values
- **Type guards** over type assertions
- **Strict null checking** - no non-null assertions (!) without justification
- **Generic constraints** when accepting unknown types

## Prohibited

```typescript
// NEVER accept these patterns in review:
const x: any = ...           // Use unknown + type narrowing
const y = value as SomeType  // Use type guards instead
// @ts-ignore                // Fix the underlying type issue
// @ts-expect-error          // Use only with documented reason
```

## Preferred Patterns

```typescript
// Type narrowing with guards
function processValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (isCustomType(value)) return value.toString();
  throw new Error("Unexpected type");
}

// Assertion functions for complex checks
function assertIsUser(value: unknown): asserts value is User {
  if (!value || typeof value !== "object" || !("id" in value)) {
    throw new Error("Not a valid User");
  }
}
```
