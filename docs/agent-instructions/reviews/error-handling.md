# Error Handling Standards

Consistent error handling improves debugging, user experience, and system reliability.

## Error Utilities

Use the shared error utilities from `@tearleads/client`:

```typescript
import { isError, getErrorMessage, toError } from "@/lib/errors";

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

// Type guard
function isError(value: unknown): value is Error {
  return value instanceof Error;
}
```

## Result Types

Use discriminated unions for operation results:

```typescript
// Standard result type
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// Usage
async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, value: data };
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) };
  }
}

// Caller handles both cases explicitly
const result = await fetchUser("123");
if (!result.ok) {
  showError(result.error);
  return;
}
useUser(result.value);
```

## Custom Error Classes

Create specific error classes for distinct error types:

```typescript
// Custom error with name for instanceof checks
export class UnsupportedFileTypeError extends Error {
  constructor(fileType: string) {
    super(`Unsupported file type: ${fileType}`);
    this.name = "UnsupportedFileTypeError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

// Usage
if (error instanceof UnsupportedFileTypeError) {
  showFileTypeError(error.message);
} else if (error instanceof AuthenticationError) {
  redirectToLogin();
}
```

## React Error Boundaries

### Using ErrorBoundary

Wrap feature sections to prevent full-page crashes:

```typescript
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

function App() {
  return (
    <div>
      <Header />
      <ErrorBoundary>
        <FeatureSection />
      </ErrorBoundary>
      <Footer />
    </div>
  );
}
```

### Programmatic Error Handling

```typescript
// Use ref to programmatically set errors
const errorBoundaryRef = useRef<ErrorBoundaryRef>(null);

const handleAsyncError = async () => {
  try {
    await riskyOperation();
  } catch (error) {
    errorBoundaryRef.current?.setError(toError(error));
  }
};

return (
  <ErrorBoundary ref={errorBoundaryRef}>
    <Component onAction={handleAsyncError} />
  </ErrorBoundary>
);
```

## API Error Responses

### Standard Format

Use consistent error response format:

```typescript
// Success responses
res.status(200).json({ ok: true, data: result });
res.status(201).json({ ok: true, data: created });

// Error responses
res.status(400).json({ error: "Invalid email format" });
res.status(401).json({ error: "Unauthorized" });
res.status(403).json({ error: "Forbidden" });
res.status(404).json({ error: "User not found" });
res.status(500).json({ error: "Internal server error" });
```

### Status Code Guide

| Code | Meaning | When to Use |
|------|---------|-------------|
| 400 | Bad Request | Validation failures, malformed input |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Authenticated but lacks permission |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource, state conflict |
| 500 | Internal Error | Unexpected server failures |

### Error Middleware

```typescript
// Express error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Request failed:", err.message);

  // Don't leak stack traces in production
  if (process.env.NODE_ENV === "production") {
    res.status(500).json({ error: "Internal server error" });
  } else {
    res.status(500).json({ error: err.message });
  }
});
```

## Async Error Handling

### Try-Catch Pattern

```typescript
// GOOD: Explicit error handling
async function fetchData() {
  try {
    const response = await fetch("/api/data");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Fetch failed:", getErrorMessage(error));
    throw error;  // Re-throw for caller to handle
  }
}

// BAD: Unhandled promise rejection
async function fetchDataBad() {
  const response = await fetch("/api/data");  // No error handling
  return response.json();
}
```

### Promise.allSettled

Handle multiple async operations gracefully:

```typescript
const results = await Promise.allSettled([
  fetchUser("1"),
  fetchUser("2"),
  fetchUser("3"),
]);

const successes = results
  .filter((r): r is PromiseFulfilledResult<User> => r.status === "fulfilled")
  .map((r) => r.value);

const failures = results
  .filter((r): r is PromiseRejectedResult => r.status === "rejected")
  .map((r) => r.reason);

if (failures.length > 0) {
  console.error("Some fetches failed:", failures);
}
```

## Logging Errors

### What to Log

```typescript
// GOOD: Log error context
console.error("Failed to process order:", {
  orderId: order.id,
  userId: user.id,
  error: getErrorMessage(error),
});

// BAD: Log sensitive data
console.error("Auth failed:", { password, token });  // NEVER
```

### What NOT to Log

- Passwords, tokens, API keys
- Full stack traces in production
- User PII (email, phone, SSN)
- Raw request bodies with sensitive data

## User-Facing Errors

### Display Patterns

```typescript
// Show user-friendly messages
function getUserMessage(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return "Please sign in to continue";
  }
  if (error instanceof NetworkError) {
    return "Unable to connect. Check your internet connection.";
  }
  // Generic fallback
  return "Something went wrong. Please try again.";
}

// Don't expose internal details
// BAD: "PostgreSQL error: relation 'users' does not exist"
// GOOD: "Unable to load user data"
```

### Loading States

```typescript
type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

function Component() {
  const [state, setState] = useState<AsyncState<User>>({ status: "idle" });

  if (state.status === "loading") return <Spinner />;
  if (state.status === "error") return <ErrorMessage>{state.error}</ErrorMessage>;
  if (state.status === "success") return <UserCard user={state.data} />;
  return <Button onClick={fetchUser}>Load</Button>;
}
```

## Review Checklist

- [ ] Async functions have try-catch or Result types
- [ ] Errors are logged with context (not sensitive data)
- [ ] API returns consistent error format
- [ ] HTTP status codes are appropriate
- [ ] User sees friendly error messages (not stack traces)
- [ ] Error boundaries wrap feature sections
- [ ] Custom error classes set `this.name`
- [ ] Promise rejections are handled
- [ ] Loading/error states in UI components
