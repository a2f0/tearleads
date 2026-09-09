import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";

afterEach(cleanup);

test("render failures report once without exposing the error, and can be retried", () => {
  const error = new Error("private document plaintext");
  const reports: unknown[] = [];
  let failed = true;
  function Child() {
    if (failed) throw error;
    return <p>Recovered</p>;
  }
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(
      <AppErrorBoundary
        area="explorer"
        diagnostics={{
          addBreadcrumb: () => {},
          captureError: (value, context) => reports.push({ value, context }),
        }}
      >
        <Child />
      </AppErrorBoundary>,
    );
    expect(reports).toEqual([
      { value: error, context: { area: "explorer", source: "boundary" } },
    ]);
    expect(view.getByRole("alert").textContent).not.toContain(error.message);
    failed = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(view.getByText("Recovered")).toBeTruthy();
  } finally {
    consoleSpy.mockRestore();
  }
});

test("a reporting failure does not break recovery", () => {
  function Child(): never {
    throw new Error("private");
  }
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(
      <AppErrorBoundary
        area="app"
        diagnostics={{
          addBreadcrumb: () => {},
          captureError: () => {
            throw new Error("offline");
          },
        }}
      >
        <Child />
      </AppErrorBoundary>,
    );
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  } finally {
    consoleSpy.mockRestore();
  }
});

test("navigation recovers a failed view without remounting healthy views", () => {
  let failed = false;
  function Child() {
    if (failed) throw new Error("private");
    return <p>Healthy</p>;
  }
  const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
  const content = (resetKey: string) => (
    <AppErrorBoundary area="explorer" resetKey={resetKey}>
      <Child />
    </AppErrorBoundary>
  );
  try {
    const view = render(content("first-private-route"));
    const healthy = view.getByText("Healthy");
    view.rerender(content("second-private-route"));
    expect(view.getByText("Healthy")).toBe(healthy);
    failed = true;
    view.rerender(content("second-private-route"));
    expect(view.getByRole("alert")).toBeTruthy();
    failed = false;
    view.rerender(content("third-private-route"));
    expect(view.getByText("Healthy")).toBeTruthy();
  } finally {
    consoleSpy.mockRestore();
  }
});
