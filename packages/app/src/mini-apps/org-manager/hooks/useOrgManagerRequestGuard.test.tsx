import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { runScopedRefresher } from "../refresh";
import {
  type OrgManagerRequestKind,
  useOrgManagerRequestGuard,
} from "./useOrgManagerRequestGuard";

afterEach(() => cleanup());

function requireBeginRequest(
  begin: ReturnType<typeof useOrgManagerRequestGuard> | null,
): ReturnType<typeof useOrgManagerRequestGuard> {
  if (!begin) {
    throw new Error("Expected request guard callback");
  }
  return begin;
}

function GuardProbe({
  capture,
  scopeKey,
}: {
  capture: (begin: ReturnType<typeof useOrgManagerRequestGuard>) => void;
  scopeKey: string;
}) {
  const begin = useOrgManagerRequestGuard(scopeKey);
  useEffect(() => capture(begin), [begin, capture]);
  return null;
}

test("org-manager request guards keep only the latest request per resource", () => {
  const captured: {
    current: ((kind: OrgManagerRequestKind) => () => boolean) | null;
  } = { current: null };
  render(
    <GuardProbe
      capture={(next) => {
        captured.current = next;
      }}
      scopeKey="org-a"
    />,
  );
  const begin = requireBeginRequest(captured.current);

  const firstDirectoryRequest = begin("directory");
  const usageRequest = begin("dataUsage");
  const secondDirectoryRequest = begin("directory");

  expect(firstDirectoryRequest()).toBe(false);
  expect(usageRequest()).toBe(true);
  expect(secondDirectoryRequest()).toBe(true);
});

test("group refreshes invalidate older pages without letting a page cancel the refresh", () => {
  const captured: {
    current: ReturnType<typeof useOrgManagerRequestGuard> | null;
  } = { current: null };
  render(
    <GuardProbe
      capture={(next) => {
        captured.current = next;
      }}
      scopeKey="org-a"
    />,
  );
  const begin = requireBeginRequest(captured.current);
  const page = begin("groupHistoryPage");
  const full = begin("groupDetails");
  expect(page()).toBe(false);
  const nextPage = begin("groupHistoryPage");
  expect(full()).toBe(true);
  expect(nextPage()).toBe(true);
});

test("org-manager request guards invalidate all work when the org changes", () => {
  const captured: {
    current: ((kind: OrgManagerRequestKind) => () => boolean) | null;
  } = { current: null };
  const capture = (next: ReturnType<typeof useOrgManagerRequestGuard>) => {
    captured.current = next;
  };
  const view = render(<GuardProbe capture={capture} scopeKey="org-a" />);
  const beginOrgA = requireBeginRequest(captured.current);
  const orgARequest = beginOrgA("directory");

  act(() => {
    view.rerender(<GuardProbe capture={capture} scopeKey="org-b" />);
  });
  const beginOrgB = requireBeginRequest(captured.current);
  const orgBRequest = beginOrgB("directory");

  expect(orgARequest()).toBe(false);
  expect(orgBRequest()).toBe(true);
});

test("org-manager request guards invalidate work on unmount", () => {
  const captured: {
    current: ((kind: OrgManagerRequestKind) => () => boolean) | null;
  } = { current: null };
  const view = render(
    <GuardProbe
      capture={(next) => {
        captured.current = next;
      }}
      scopeKey="org-a"
    />,
  );
  const begin = requireBeginRequest(captured.current);
  const request = begin("grants");

  view.unmount();

  expect(request()).toBe(false);
});

test("a delayed follow-up cannot start a policy load after Org Manager unmounts", async () => {
  const captured: {
    current: ReturnType<typeof useOrgManagerRequestGuard> | null;
  } = { current: null };
  const view = render(
    <GuardProbe
      capture={(next) => {
        captured.current = next;
      }}
      scopeKey="org-a"
    />,
  );
  const beginRequest = requireBeginRequest(captured.current);
  const precedingRead = Promise.withResolvers<void>();
  const load = mock(async () => "policy");
  const updateView = mock(() => {});
  const followUp = precedingRead.promise.then(() =>
    runScopedRefresher({
      apply: updateView,
      beginRequest,
      load,
      requestKind: "groupDetails",
      setError: updateView,
      setLoading: updateView,
      onSettled: updateView,
    }),
  );

  view.unmount();
  precedingRead.resolve();
  await followUp;

  expect(load).not.toHaveBeenCalled();
  expect(updateView).not.toHaveBeenCalled();
});
