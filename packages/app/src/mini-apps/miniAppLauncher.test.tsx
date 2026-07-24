import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AppRouteState } from "../navigation/AppRoutePaths";
import {
  MiniAppLauncherProvider,
  useActiveMiniAppRoute,
  useMiniAppLauncher,
  useRegisterMiniAppLauncher,
} from "./miniAppLauncher";
import type { OpenMiniAppRequest } from "./types";

afterEach(() => cleanup());

const BILLING_REQUEST = {
  appId: "org-manager",
  pathSegments: ["billing"],
} as const satisfies AppRouteState;
const EMPTY_ROUTE: AppRouteState = { appId: null, pathSegments: [] };

function Registrar({
  active,
  launch,
  route = EMPTY_ROUTE,
}: {
  active: boolean;
  launch: (request: OpenMiniAppRequest) => void;
  route?: AppRouteState | undefined;
}) {
  useRegisterMiniAppLauncher(launch, active, route);
  return null;
}

function ActiveRoute() {
  const route = useActiveMiniAppRoute();
  return (
    <span>
      {route ? `${route.appId}:${route.pathSegments.join("/")}` : "none"}
    </span>
  );
}

function LaunchButton() {
  const launch = useMiniAppLauncher();
  return (
    <button onClick={() => launch(BILLING_REQUEST)} type="button">
      launch
    </button>
  );
}

test("launch reaches the active pane's registered launcher", () => {
  const launch = mock((_request: OpenMiniAppRequest) => {});
  const { getByRole } = render(
    <MiniAppLauncherProvider>
      <Registrar active={true} launch={launch} />
      <LaunchButton />
    </MiniAppLauncherProvider>,
  );
  fireEvent.click(getByRole("button", { name: "launch" }));
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledWith(BILLING_REQUEST);
});

test("an inactive pane does not receive launches", () => {
  const launch = mock((_request: OpenMiniAppRequest) => {});
  const { getByRole } = render(
    <MiniAppLauncherProvider>
      <Registrar active={false} launch={launch} />
      <LaunchButton />
    </MiniAppLauncherProvider>,
  );
  fireEvent.click(getByRole("button", { name: "launch" }));
  expect(launch).not.toHaveBeenCalled();
});

test("only the active launcher receives launches when panes coexist", () => {
  const activeLaunch = mock((_request: OpenMiniAppRequest) => {});
  const inactiveLaunch = mock((_request: OpenMiniAppRequest) => {});
  const { getByRole } = render(
    <MiniAppLauncherProvider>
      <Registrar active={false} launch={inactiveLaunch} />
      <Registrar active={true} launch={activeLaunch} />
      <LaunchButton />
    </MiniAppLauncherProvider>,
  );
  fireEvent.click(getByRole("button", { name: "launch" }));
  expect(activeLaunch).toHaveBeenCalledTimes(1);
  expect(inactiveLaunch).not.toHaveBeenCalled();
});

test("the active pane publishes its current mini-app route", () => {
  const launch = mock((_request: OpenMiniAppRequest) => {});
  const { getByText, rerender } = render(
    <MiniAppLauncherProvider>
      <Registrar active={true} launch={launch} route={BILLING_REQUEST} />
      <ActiveRoute />
    </MiniAppLauncherProvider>,
  );
  expect(getByText("org-manager:billing")).toBeDefined();

  rerender(
    <MiniAppLauncherProvider>
      <Registrar
        active={true}
        launch={launch}
        route={{ appId: "explorer", pathSegments: [] }}
      />
      <ActiveRoute />
    </MiniAppLauncherProvider>,
  );
  expect(getByText("explorer:")).toBeDefined();
});

test("a stale pane cannot replace the active pane route", () => {
  const staleLaunch = mock((_request: OpenMiniAppRequest) => {});
  const activeLaunch = mock((_request: OpenMiniAppRequest) => {});
  const activeRoute: AppRouteState = { appId: "explorer", pathSegments: [] };
  const rendered = render(
    <MiniAppLauncherProvider>
      <Registrar active={true} launch={staleLaunch} route={BILLING_REQUEST} />
      <Registrar active={true} launch={activeLaunch} route={activeRoute} />
      <ActiveRoute />
    </MiniAppLauncherProvider>,
  );
  expect(rendered.getByText("explorer:")).toBeDefined();

  rendered.rerender(
    <MiniAppLauncherProvider>
      <Registrar
        active={true}
        launch={staleLaunch}
        route={{ appId: "notes", pathSegments: [] }}
      />
      <Registrar active={true} launch={activeLaunch} route={activeRoute} />
      <ActiveRoute />
    </MiniAppLauncherProvider>,
  );
  expect(rendered.getByText("explorer:")).toBeDefined();
});

test("unregistering the active pane clears its route", () => {
  const launch = mock((_request: OpenMiniAppRequest) => {});
  const rendered = render(
    <MiniAppLauncherProvider>
      <Registrar active={true} launch={launch} route={BILLING_REQUEST} />
      <ActiveRoute />
    </MiniAppLauncherProvider>,
  );
  expect(rendered.getByText("org-manager:billing")).toBeDefined();

  rendered.rerender(
    <MiniAppLauncherProvider>
      <Registrar active={false} launch={launch} route={BILLING_REQUEST} />
      <ActiveRoute />
    </MiniAppLauncherProvider>,
  );
  expect(rendered.getByText("none")).toBeDefined();
});

test("launch is a no-op when no provider is mounted", () => {
  const { getByRole } = render(<LaunchButton />);
  // Must not throw: app-shell chrome may render before a pane registers.
  fireEvent.click(getByRole("button", { name: "launch" }));
  expect(getByRole("button", { name: "launch" })).toBeDefined();
});
