import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { MiniAppRouteSegmentsProvider } from "./MiniAppRouteSegmentsContext";
import {
  type MiniAppRouteSetOptions,
  useMiniAppRouteState,
} from "./useMiniAppRouteState";

type TestRoute = "detail" | "menu";

function formatTestRouteSegments(route: TestRoute): ReadonlyArray<string> {
  return route === "menu" ? [] : [route];
}

function parseTestRouteSegments(segments: ReadonlyArray<string>): TestRoute {
  return segments[0] === "detail" ? "detail" : "menu";
}

function useLocalTestRoute() {
  const [localRoute, setLocalRoute] = useState<TestRoute>("menu");
  return useMiniAppRouteState({
    appId: "identity-manager",
    formatRouteSegments: formatTestRouteSegments,
    localRoute,
    parseRouteSegments: parseTestRouteSegments,
    setLocalRoute,
  });
}

test("mini-app route state updates its local fallback outside a routed host", () => {
  const view = renderHook(useLocalTestRoute);

  act(() => view.result.current.setRoute("detail"));

  expect(view.result.current.isRouted).toBe(false);
  expect(view.result.current.route).toBe("detail");
});

test("mini-app route state parses hosted segments and forwards replace", () => {
  const updates: Array<{
    options: MiniAppRouteSetOptions | undefined;
    segments: ReadonlyArray<string>;
  }> = [];
  const setPathSegments = (
    segments: ReadonlyArray<string>,
    options?: MiniAppRouteSetOptions,
  ) => updates.push({ options, segments });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MiniAppRouteSegmentsProvider
      appId="identity-manager"
      canGoBack={false}
      goBack={() => {}}
      pathSegments={["detail"]}
      setPathSegments={setPathSegments}
    >
      {children}
    </MiniAppRouteSegmentsProvider>
  );
  const view = renderHook(useLocalTestRoute, { wrapper });

  act(() => view.result.current.setRoute("menu", { replace: true }));

  expect(view.result.current.isRouted).toBe(true);
  expect(view.result.current.route).toBe("detail");
  expect(updates).toEqual([{ options: { replace: true }, segments: [] }]);
});

test("mini-app route state can expose a read-only local fallback", () => {
  const view = renderHook(() =>
    useMiniAppRouteState({
      appId: "notes",
      formatRouteSegments: formatTestRouteSegments,
      localRoute: "detail" as TestRoute,
      parseRouteSegments: parseTestRouteSegments,
    }),
  );

  act(() => view.result.current.setRoute("menu"));

  expect(view.result.current.isRouted).toBe(false);
  expect(view.result.current.route).toBe("detail");
});
