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

## Type Guards

### Basic Type Guards

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

### Object Type Guards

```typescript
// Helper for checking objects
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Type guard with property checks
function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string"
  );
}

// Usage
if (isUser(data)) {
  console.log(data.email);  // TypeScript knows data is User
}
```

### Discriminated Unions

```typescript
// GOOD: Use discriminated unions for result types
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function processResult(result: Result<User>) {
  if (result.ok) {
    return result.value.name;  // TypeScript knows value exists
  }
  throw new Error(result.error);  // TypeScript knows error exists
}

// BAD: Nullable with separate error field
type BadResult<T> = { value?: T; error?: string };  // Ambiguous
```

## Async Patterns

### Error Handling

```typescript
// GOOD: Explicit error handling with typed results
async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const response = await fetch(`/users/${id}`);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    if (!isUser(data)) {
      return { ok: false, error: "Invalid user data" };
    }
    return { ok: true, value: data };
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) };
  }
}

// BAD: Throwing without type information
async function fetchUserBad(id: string): Promise<User> {
  const response = await fetch(`/users/${id}`);
  return response.json();  // No error handling, no validation
}
```

### Promise.all with Error Handling

```typescript
// Parallel operations with individual error handling
const results = await Promise.allSettled([
  fetchUser("1"),
  fetchUser("2"),
  fetchUser("3"),
]);

const users = results
  .filter((r): r is PromiseFulfilledResult<Result<User>> =>
    r.status === "fulfilled" && r.value.ok
  )
  .map((r) => r.value.value);
```

## Utility Types

```typescript
// Pick only what you need
type UserSummary = Pick<User, "id" | "name">;

// Make properties optional for updates
type UserUpdate = Partial<Omit<User, "id">>;

// Required for validation
type RequiredUser = Required<User>;

// Readonly for immutability
type ImmutableUser = Readonly<User>;
```

## Validation Patterns

### Custom Validators

```typescript
// Validation result type
type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// Validator function with context
function validateEmail(
  value: unknown,
  field: string
): ValidateResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  if (!value.includes("@")) {
    return { ok: false, error: `${field} must be a valid email` };
  }
  return { ok: true, value };
}

// Compose validators
function validateUser(data: unknown): ValidateResult<User> {
  if (!isRecord(data)) {
    return { ok: false, error: "Expected object" };
  }

  const email = validateEmail(data.email, "email");
  if (!email.ok) return email;

  const name = validateString(data.name, "name");
  if (!name.ok) return name;

  return { ok: true, value: { email: email.value, name: name.value } };
}
```

## Error Handling Utilities

```typescript
// Type-safe error message extraction
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

// Convert unknown to Error
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(getErrorMessage(value));
}

// Type guard for error checking
function isError(value: unknown): value is Error {
  return value instanceof Error;
}
```

## Review Checklist

- [ ] No `any` types (use `unknown` with narrowing)
- [ ] No `as` type assertions (use type guards)
- [ ] No `@ts-ignore` or unqualified `@ts-expect-error`
- [ ] Explicit return types on exported functions
- [ ] Discriminated unions for result types
- [ ] Error handling in async functions
- [ ] Type guards for runtime validation
- [ ] Generic constraints where applicable
