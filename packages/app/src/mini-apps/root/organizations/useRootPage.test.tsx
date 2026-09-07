import { afterEach, expect, test } from "bun:test";
import type { RootRequestOutcome } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRootPage } from "./useRootPage";

afterEach(cleanup);
type Page = { items: string[]; nextCursor: string | null };
function page(
  items: string[],
  nextCursor: string | null = null,
): RootRequestOutcome<Page> {
  return { ok: true, data: { items, nextCursor } };
}

test("changing the query drops a late reply from the previous listing", async () => {
  let release: ((result: RootRequestOutcome<Page>) => void) | undefined;
  const stale = new Promise<RootRequestOutcome<Page>>((resolve) => {
    release = resolve;
  });
  const oldRequest = () => stale;
  const newRequest = async () => page(["new organization"]);
  const view = renderHook(({ request }) => useRootPage(request), {
    initialProps: { request: oldRequest },
  });
  view.rerender({ request: newRequest });
  await waitFor(() =>
    expect(view.result.current.items).toEqual(["new organization"]),
  );
  await act(async () => {
    release?.(page(["old organization"]));
  });
  expect(view.result.current.items).toEqual(["new organization"]);
});

test("paging appends rows and a failed refresh cannot resume an old cursor", async () => {
  let fail = false;
  const cursors: (string | null)[] = [];
  const request = async (cursor: string | null) => {
    cursors.push(cursor);
    if (fail) throw new Error("Connection lost");
    return cursor === null ? page(["first"], "next") : page(["second"]);
  };
  const view = renderHook(() => useRootPage(request));
  await waitFor(() => expect(view.result.current.nextCursor).toBe("next"));
  act(() => view.result.current.loadMore());
  await waitFor(() =>
    expect(view.result.current.items).toEqual(["first", "second"]),
  );
  act(() => view.result.current.refresh());
  await waitFor(() => expect(view.result.current.nextCursor).toBe("next"));
  fail = true;
  act(() => view.result.current.refresh());
  await waitFor(() =>
    expect(view.result.current.error).toBe("Connection lost"),
  );
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.nextCursor).toBeNull();
  act(() => view.result.current.loadMore());
  expect(cursors).toEqual([null, "next", null, null]);
});
