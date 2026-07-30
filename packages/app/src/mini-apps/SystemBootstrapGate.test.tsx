import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useSystemBootstrapBlocking } from "./SystemBootstrapGate";

/*
 * The gate blocks an app from opening before its system containers exist. What
 * it must not do is close one that is already open: bootstrap reports "not
 * bootstrapping" both before its first run starts and after it finishes, so an
 * app rendered during the pending window would otherwise be replaced by the
 * bootstrap panel the moment the run begins.
 *
 * Tests the hook rather than the component on purpose. Reaching the component
 * means faking the bootstrap and window-sidebar providers, and `mock.module` is
 * process-wide in bun — mocking two providers this widely used would replace
 * them for every test file that ran afterwards.
 */

afterEach(cleanup);

test("blocks while the first bootstrap run is under way", () => {
  const { result } = renderHook(
    (bootstrapping: boolean) => useSystemBootstrapBlocking(bootstrapping),
    { initialProps: true },
  );

  expect(result.current).toBe(true);
});

test("does not block when no run is under way", () => {
  const { result } = renderHook(
    (bootstrapping: boolean) => useSystemBootstrapBlocking(bootstrapping),
    { initialProps: false },
  );

  expect(result.current).toBe(false);
});

test("keeps an already-rendered app on screen when a run starts", () => {
  // The deep-link sequence: the run is still pending, so the app renders; then
  // the run begins. Blocking here is what read as a flash of the app, then a
  // spinner, then the app.
  const { rerender, result } = renderHook(
    (bootstrapping: boolean) => useSystemBootstrapBlocking(bootstrapping),
    { initialProps: false },
  );
  expect(result.current).toBe(false);

  rerender(true);
  expect(result.current).toBe(false);
});

test("still blocks a gate that has never rendered its app", () => {
  // A mini-app opened while a run is already in flight has shown nothing yet,
  // so it is genuinely pre-open and the panel is right for it.
  const { rerender, result } = renderHook(
    (bootstrapping: boolean) => useSystemBootstrapBlocking(bootstrapping),
    { initialProps: true },
  );
  expect(result.current).toBe(true);

  rerender(false);
  expect(result.current).toBe(false);

  // And once it has rendered, a later run does not take it away either.
  rerender(true);
  expect(result.current).toBe(false);
});
