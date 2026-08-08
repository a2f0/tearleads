import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MiniAppRouteSegmentsProvider } from "../../navigation/MiniAppRouteSegmentsContext";
import type { MiniAppRouteSetOptions } from "../../navigation/useMiniAppRouteState";
import {
  formatIdentityManagerRouteSegments,
  parseIdentityManagerRouteSegments,
} from "./routes";
import { useIdentityManagerRoute } from "./useIdentityManagerRoute";

test("identity manager base and unknown routes resolve to the section menu", () => {
  expect(parseIdentityManagerRouteSegments([])).toBe("menu");
  expect(parseIdentityManagerRouteSegments(["unknown"])).toBe("menu");
  expect(formatIdentityManagerRouteSegments("menu")).toEqual([]);
});

test("identity manager routes preserve each section", () => {
  for (const view of [
    "general",
    "recovery-key",
    "pin-lock",
    "active-sessions",
  ] as const) {
    expect(parseIdentityManagerRouteSegments([view])).toBe(view);
    expect(formatIdentityManagerRouteSegments(view)).toEqual([view]);
  }
});

test("identity-manager route updates forward the replace option", () => {
  const updates: Array<{
    options: MiniAppRouteSetOptions | undefined;
    segments: ReadonlyArray<string>;
  }> = [];
  const setPathSegments = (
    segments: ReadonlyArray<string>,
    options?: MiniAppRouteSetOptions,
  ) => updates.push({ options, segments });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MiniAppRouteSegmentsProvider,
      {
        appId: "identity-manager",
        canGoBack: false,
        goBack: () => {},
        pathSegments: ["pin-lock"],
        setPathSegments,
      },
      children,
    );
  const view = renderHook(useIdentityManagerRoute, { wrapper });

  act(() => view.result.current.setView("general", { replace: true }));

  expect(view.result.current.view).toBe("pin-lock");
  expect(updates).toEqual([
    { options: { replace: true }, segments: ["general"] },
  ]);
});
