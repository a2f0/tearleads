import { expect, test } from "bun:test";
import { act, render, renderHook } from "@testing-library/react";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./index";
import { at, byTitle, wrapper } from "./testUtils";

function useWindowStateTestHarness() {
  return {
    actions: useWindowActions(),
    state: useWindowStateData(),
  };
}

test("create assigns incrementing zIndex values", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() => result.current.actions.create("A", 0, 0));
  act(() => result.current.actions.create("B", 10, 10));
  act(() => result.current.actions.create("C", 20, 20));

  expect(byTitle(result, "A").zIndex).toBe(1);
  expect(byTitle(result, "B").zIndex).toBe(2);
  expect(byTitle(result, "C").zIndex).toBe(3);
});

test("updateTitle, minimize, and restore update the tracked window state", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() => result.current.actions.create("Original", 0, 0));
  const id = at(result, 0).id;

  act(() => result.current.actions.updateTitle(id, "Renamed"));

  expect(byTitle(result, "Renamed").title).toBe("Renamed");
  expect(result.current.state.windowMap.get(id)?.title).toBe("Renamed");

  act(() => result.current.actions.minimize(id));
  expect(result.current.state.windowMap.get(id)?.minimized).toBe(true);

  act(() => result.current.actions.restore(id));
  expect(result.current.state.windowMap.get(id)?.minimized).toBe(false);
});

test("create stores optional app metadata", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() =>
    result.current.actions.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
      miniAppPathSegments: ["items", "container-1"],
    }),
  );

  expect(at(result, 0).appId).toBe("explorer");
  expect(at(result, 0).miniAppPathSegments).toEqual(["items", "container-1"]);
});

test("updateMiniAppRoute updates route metadata without mutating input", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });
  const pathSegments = ["items", "container-1"];

  act(() =>
    result.current.actions.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
    }),
  );
  const id = at(result, 0).id;

  act(() => result.current.actions.updateMiniAppRoute(id, pathSegments));
  pathSegments.push("ignored");

  expect(result.current.state.windowMap.get(id)?.miniAppPathSegments).toEqual([
    "items",
    "container-1",
  ]);
});

test("updateMiniAppRoute skips unchanged route metadata", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() =>
    result.current.actions.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
      miniAppPathSegments: ["items", "container-1"],
    }),
  );
  const id = at(result, 0).id;
  const windowsBeforeUpdate = result.current.state.windows;

  act(() =>
    result.current.actions.updateMiniAppRoute(id, ["items", "container-1"]),
  );

  expect(result.current.state.windows).toBe(windowsBeforeUpdate);
});

// A window is not backed by browser history, so its Back caret walks this stack.
test("updateMiniAppRoute stacks visited routes and goBackMiniAppRoute pops them", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() =>
    result.current.actions.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
      miniAppPathSegments: ["items", "container-1"],
    }),
  );
  const id = at(result, 0).id;

  act(() =>
    result.current.actions.updateMiniAppRoute(id, [
      "containers",
      "container-1",
      "documents",
      "doc-1",
    ]),
  );
  act(() =>
    result.current.actions.updateMiniAppRoute(id, [
      "containers",
      "container-1",
      "documents",
      "doc-1",
      "info",
    ]),
  );

  expect(result.current.state.windowMap.get(id)?.miniAppRouteHistory).toEqual([
    ["items", "container-1"],
    ["containers", "container-1", "documents", "doc-1"],
  ]);

  // Each Back unwinds exactly one entry — it never pushes a parent route back on
  // top, which is what made Back alternate between two panes forever.
  act(() => result.current.actions.goBackMiniAppRoute(id));

  expect(result.current.state.windowMap.get(id)?.miniAppPathSegments).toEqual([
    "containers",
    "container-1",
    "documents",
    "doc-1",
  ]);

  act(() => result.current.actions.goBackMiniAppRoute(id));

  expect(result.current.state.windowMap.get(id)?.miniAppPathSegments).toEqual([
    "items",
    "container-1",
  ]);
  expect(result.current.state.windowMap.get(id)?.miniAppRouteHistory).toEqual(
    [],
  );
});

test("goBackMiniAppRoute is inert with an empty history", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() =>
    result.current.actions.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
      miniAppPathSegments: ["items", "container-1"],
    }),
  );
  const id = at(result, 0).id;
  const windowsBeforeBack = result.current.state.windows;

  act(() => result.current.actions.goBackMiniAppRoute(id));

  expect(result.current.state.windows).toBe(windowsBeforeBack);
  expect(result.current.state.windowMap.get(id)?.miniAppPathSegments).toEqual([
    "items",
    "container-1",
  ]);
});

// A replacing navigation swaps the current entry, so the transient step it
// replaced (e.g. the new-document type picker) never becomes a Back destination.
test("a replacing updateMiniAppRoute does not stack a history entry", () => {
  const { result } = renderHook(useWindowStateTestHarness, { wrapper });

  act(() =>
    result.current.actions.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
      miniAppPathSegments: ["items", "container-1"],
    }),
  );
  const id = at(result, 0).id;

  act(() =>
    result.current.actions.updateMiniAppRoute(id, [
      "containers",
      "container-1",
      "new",
    ]),
  );
  act(() =>
    result.current.actions.updateMiniAppRoute(id, ["items", "doc-1"], {
      replace: true,
    }),
  );

  expect(result.current.state.windowMap.get(id)?.miniAppPathSegments).toEqual([
    "items",
    "doc-1",
  ]);
  expect(result.current.state.windowMap.get(id)?.miniAppRouteHistory).toEqual([
    ["items", "container-1"],
  ]);

  act(() => result.current.actions.goBackMiniAppRoute(id));

  expect(result.current.state.windowMap.get(id)?.miniAppPathSegments).toEqual([
    "items",
    "container-1",
  ]);
});

test("zIndex change triggers re-render in consuming component", () => {
  const zIndices: number[][] = [];

  function Consumer() {
    const { windows } = useWindowStateData();
    const { create, moveForward } = useWindowActions();
    zIndices.push(windows.map((windowEntry) => windowEntry.zIndex));
    const firstId = windows[0]?.id;
    return (
      <>
        <button
          type="button"
          data-testid="add"
          onClick={() => create("Win", 0, 0)}
        />
        {windows.length >= 2 && firstId && (
          <button
            type="button"
            data-testid="forward"
            onClick={() => moveForward(firstId)}
          />
        )}
        {windows.map((windowEntry) => (
          <div key={windowEntry.id} data-testid={`z-${windowEntry.id}`}>
            {windowEntry.zIndex}
          </div>
        ))}
      </>
    );
  }

  const view = render(
    <WindowStateProvider>
      <Consumer />
    </WindowStateProvider>,
  );

  act(() => view.getByTestId("add").click());
  act(() => view.getByTestId("add").click());

  expect(zIndices.at(-1)).toEqual([1, 2]);

  act(() => view.getByTestId("forward").click());

  expect(zIndices.at(-1)).toEqual([2, 1]);
  expect(view.getByTestId("z-1").textContent).toBe("2");
  expect(view.getByTestId("z-2").textContent).toBe("1");
});

test("action-only consumers do not re-render when window state changes", () => {
  let actionRenderCount = 0;
  let stateRenderCount = 0;

  function ActionConsumer() {
    actionRenderCount += 1;
    const { create } = useWindowActions();

    return (
      <button
        type="button"
        data-testid="add-action-only"
        onClick={() => create("Win", 0, 0)}
      >
        Add
      </button>
    );
  }

  function StateConsumer() {
    stateRenderCount += 1;
    const { windows } = useWindowStateData();

    return <div data-testid="count">{windows.length}</div>;
  }

  const view = render(
    <WindowStateProvider>
      <ActionConsumer />
      <StateConsumer />
    </WindowStateProvider>,
  );

  expect(actionRenderCount).toBe(1);
  expect(stateRenderCount).toBe(1);

  act(() => view.getByTestId("add-action-only").click());

  expect(view.getByTestId("count").textContent).toBe("1");
  expect(actionRenderCount).toBe(1);
  expect(stateRenderCount).toBe(2);
});
