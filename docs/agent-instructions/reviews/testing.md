# Testing Standards

This codebase uses **Vitest** (not Jest) with React Testing Library and MSW for mocking.

## Test Organization

- **Colocated tests** - `Component.test.tsx` next to `Component.tsx`
- **Test naming** - `*.test.ts` for utilities, `*.test.tsx` for React components
- **Setup files** - Each package has `src/test/setup.ts` for shared initialization

## Vitest Patterns

### Basic Structure

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("ModuleName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("describes expected behavior", () => {
    expect(result).toBe(expected);
  });
});
```

### Mocking

```typescript
// Mock a module
vi.mock("./dependency", () => ({
  fetchData: vi.fn().mockResolvedValue({ data: "test" }),
}));

// Mock a function
const mockFn = vi.fn();
mockFn.mockReturnValue("result");
mockFn.mockResolvedValue("async result");

// Spy on existing function
const spy = vi.spyOn(console, "error").mockImplementation(() => {});

// Mock environment variables
vi.stubEnv("API_KEY", "test-key");
```

### Async Testing

```typescript
it("handles async operations", async () => {
  const result = await fetchData();
  expect(result).toEqual({ data: "test" });
});

// With fake timers
it("handles timeouts", async () => {
  vi.useFakeTimers();
  const promise = delayedOperation();
  vi.advanceTimersByTime(1000);
  await expect(promise).resolves.toBe("done");
  vi.useRealTimers();
});
```

## React Testing Library

### Query Priority

Use the most accessible query (matches user experience):

```typescript
// Priority order (use first available):
screen.getByRole("button", { name: "Submit" });  // Best - semantic
screen.getByLabelText("Email");                   // Good - form labels
screen.getByPlaceholderText("Search...");         // OK - visible text
screen.getByText("Welcome");                      // OK - visible text
screen.getByTestId("custom-element");             // Last resort
```

### User Interaction

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("handles form submission", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();

  render(<Form onSubmit={onSubmit} />);

  // Type in input
  await user.type(screen.getByLabelText("Name"), "John");

  // Click button
  await user.click(screen.getByRole("button", { name: "Submit" }));

  expect(onSubmit).toHaveBeenCalledWith({ name: "John" });
});
```

### Async Assertions

```typescript
import { waitFor, waitForElementToBeRemoved } from "@testing-library/react";

// Wait for element to appear
await waitFor(() => {
  expect(screen.getByText("Loaded")).toBeInTheDocument();
});

// Wait for element to disappear
await waitForElementToBeRemoved(() => screen.queryByText("Loading..."));

// Use findBy for async queries (combines getBy + waitFor)
const element = await screen.findByText("Loaded");
```

## API Testing with Supertest

```typescript
import request from "supertest";
import { app } from "../app";

describe("POST /api/users", () => {
  it("creates user with valid data", async () => {
    const response = await request(app)
      .post("/api/users")
      .send({ name: "John", email: "john@example.com" })
      .set("Authorization", `Bearer ${testToken}`);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      data: { name: "John" },
    });
  });

  it("returns 401 without auth", async () => {
    const response = await request(app)
      .post("/api/users")
      .send({ name: "John" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });
});
```

## MSW (Mock Service Worker)

### Handler Setup

```typescript
// packages/msw/src/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/users", () => {
    return HttpResponse.json({
      ok: true,
      data: [{ id: "1", name: "John" }],
    });
  }),

  http.post("/api/users", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ ok: true, data: body }, { status: 201 });
  }),
];
```

### Test-Specific Overrides

```typescript
import { server } from "../mocks/server";
import { http, HttpResponse } from "msw";

it("handles API error", async () => {
  // Override default handler for this test
  server.use(
    http.get("/api/users", () => {
      return HttpResponse.json({ error: "Server error" }, { status: 500 });
    })
  );

  render(<UserList />);
  await screen.findByText("Failed to load users");
});
```

## Coverage Requirements

Coverage thresholds are enforced per package:

| Package | Statements | Branches | Functions | Lines |
| ------- | ---------- | -------- | --------- | ----- |
| api     | 90%        | 85%      | 90%       | 90%   |
| ui      | 74%        | 71%      | 76%       | 75%   |

### Run Coverage

```bash
# Single package
pnpm --filter @tearleads/api test:coverage

# All packages
pnpm test:coverage
```

## What to Test

### Happy Path

Every feature needs at least one happy path test:

```typescript
it("creates user successfully", async () => {
  const result = await createUser({ name: "John", email: "john@test.com" });
  expect(result.ok).toBe(true);
  expect(result.value.name).toBe("John");
});
```

### Error Cases

Test explicit error handling:

```typescript
it("returns error for invalid email", async () => {
  const result = await createUser({ name: "John", email: "invalid" });
  expect(result.ok).toBe(false);
  expect(result.error).toBe("Invalid email format");
});

it("returns 401 when not authenticated", async () => {
  const response = await request(app).get("/api/protected");
  expect(response.status).toBe(401);
});
```

### Edge Cases

Test boundary conditions:

```typescript
it("handles empty list", () => {
  render(<UserList users={[]} />);
  expect(screen.getByText("No users found")).toBeInTheDocument();
});

it("handles maximum length input", async () => {
  const longName = "a".repeat(255);
  const result = await createUser({ name: longName, email: "test@test.com" });
  expect(result.ok).toBe(true);
});
```

## Test Utilities

### Auth Helpers

```typescript
// packages/api/src/test/auth.ts
import { createAuthHeader } from "../test/auth";

it("requires authentication", async () => {
  const response = await request(app)
    .get("/api/protected")
    .set(...createAuthHeader({ userId: "test-user" }));

  expect(response.status).toBe(200);
});
```

### Console Mocks

```typescript
// Suppress expected console output
import { mockConsoleError } from "../test/consoleMocks";

it("logs error on failure", async () => {
  const mock = mockConsoleError();
  await failingOperation();
  expect(mock).toHaveBeenCalledWith(expect.stringContaining("Failed"));
});
```

## Review Checklist

- [ ] New code has corresponding tests
- [ ] Tests use `getByRole` before `getByTestId`
- [ ] Async tests use `await` and proper assertions
- [ ] Mocks are cleaned up in `afterEach`
- [ ] Coverage thresholds maintained
- [ ] Error cases tested, not just happy path
- [ ] No `test.skip` or `test.todo` without explanation
- [ ] Console warnings/errors handled (failOnConsole is enabled)
