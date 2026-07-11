import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
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
