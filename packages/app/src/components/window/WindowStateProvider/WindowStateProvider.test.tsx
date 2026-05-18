import { expect, test } from "bun:test";
import { act, render, renderHook } from "@testing-library/react";
import {
  useWindowActions,
  useWindowState,
  useWindowStateData,
  WindowStateProvider,
} from "./index";
import { at, byTitle, wrapper } from "./testUtils";

test("create assigns incrementing zIndex values", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));
  act(() => result.current.create("C", 20, 20));

  expect(byTitle(result, "A").zIndex).toBe(1);
  expect(byTitle(result, "B").zIndex).toBe(2);
  expect(byTitle(result, "C").zIndex).toBe(3);
});

test("updateTitle, minimize, and restore update the tracked window state", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("Original", 0, 0));
  const id = at(result, 0).id;

  act(() => result.current.updateTitle(id, "Renamed"));

  expect(byTitle(result, "Renamed").title).toBe("Renamed");
  expect(result.current.windowMap.get(id)?.title).toBe("Renamed");

  act(() => result.current.minimize(id));
  expect(result.current.windowMap.get(id)?.minimized).toBe(true);

  act(() => result.current.restore(id));
  expect(result.current.windowMap.get(id)?.minimized).toBe(false);
});

test("create stores optional app metadata", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() =>
    result.current.create("Explorer", 0, 0, undefined, {
      appId: "explorer",
    }),
  );

  expect(at(result, 0).appId).toBe("explorer");
});

test("zIndex change triggers re-render in consuming component", () => {
  const zIndices: number[][] = [];

  function Consumer() {
    const { windows, create, moveForward } = useWindowState();
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
