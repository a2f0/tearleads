import { expect, test } from "bun:test";
import { act, render, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { useWindowState, WindowStateProvider } from "./WindowStateProvider";

function wrapper({ children }: PropsWithChildren) {
  return <WindowStateProvider>{children}</WindowStateProvider>;
}

interface HookResult {
  current: ReturnType<typeof useWindowState>;
}

function byTitle(result: HookResult, title: string) {
  const w = result.current.windows.find(
    (w: { title: string }) => w.title === title,
  );
  if (!w) throw new Error(`window "${title}" not found`);
  return w;
}

function at(result: HookResult, index: number) {
  const w = result.current.windows[index];
  if (!w) throw new Error(`no window at index ${index}`);
  return w;
}

test("create assigns incrementing zIndex values", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));
  act(() => result.current.create("C", 20, 20));

  expect(byTitle(result, "A").zIndex).toBe(1);
  expect(byTitle(result, "B").zIndex).toBe(2);
  expect(byTitle(result, "C").zIndex).toBe(3);
});

test("moveForward swaps zIndex with next higher window", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));
  act(() => result.current.create("C", 20, 20));

  const idA = at(result, 0).id;

  act(() => result.current.moveForward(idA));

  expect(byTitle(result, "A").zIndex).toBe(2);
  expect(byTitle(result, "B").zIndex).toBe(1);
  expect(byTitle(result, "C").zIndex).toBe(3);
});

test("moveBackward swaps zIndex with next lower window", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));
  act(() => result.current.create("C", 20, 20));

  const idC = at(result, 2).id;

  act(() => result.current.moveBackward(idC));

  expect(byTitle(result, "A").zIndex).toBe(1);
  expect(byTitle(result, "B").zIndex).toBe(3);
  expect(byTitle(result, "C").zIndex).toBe(2);
});

test("moveForward on topmost window is a no-op", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));

  const idB = at(result, 1).id;

  act(() => result.current.moveForward(idB));

  expect(byTitle(result, "A").zIndex).toBe(1);
  expect(byTitle(result, "B").zIndex).toBe(2);
});

test("moveBackward on bottommost window is a no-op", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));

  const idA = at(result, 0).id;

  act(() => result.current.moveBackward(idA));

  expect(byTitle(result, "A").zIndex).toBe(1);
  expect(byTitle(result, "B").zIndex).toBe(2);
});

test("zIndex change triggers re-render in consuming component", () => {
  const zIndices: number[][] = [];

  function Consumer() {
    const { windows, create, moveForward } = useWindowState();
    zIndices.push(windows.map((w) => w.zIndex));
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
            data-testid="fwd"
            onClick={() => moveForward(firstId)}
          />
        )}
        {windows.map((w) => (
          <div key={w.id} data-testid={`z-${w.id}`}>
            {w.zIndex}
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

  act(() => view.getByTestId("fwd").click());

  expect(zIndices.at(-1)).toEqual([2, 1]);
  expect(view.getByTestId("z-1").textContent).toBe("2");
  expect(view.getByTestId("z-2").textContent).toBe("1");
});

test("array order is unchanged after moveForward", () => {
  const { result } = renderHook(() => useWindowState(), { wrapper });

  act(() => result.current.create("A", 0, 0));
  act(() => result.current.create("B", 10, 10));
  act(() => result.current.create("C", 20, 20));

  const idA = at(result, 0).id;

  act(() => result.current.moveForward(idA));

  expect(at(result, 0).title).toBe("A");
  expect(at(result, 1).title).toBe("B");
  expect(at(result, 2).title).toBe("C");
});
