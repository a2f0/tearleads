import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  MiniAppLauncherProvider,
  useMiniAppLauncher,
  useRegisterMiniAppLauncher,
} from "./miniAppLauncher";
import type { OpenMiniAppRequest } from "./types";

afterEach(() => cleanup());

const BILLING_REQUEST: OpenMiniAppRequest = {
  appId: "org-manager",
  pathSegments: ["billing"],
};

function Registrar({
  active,
  launch,
}: {
  active: boolean;
  launch: (request: OpenMiniAppRequest) => void;
}) {
  useRegisterMiniAppLauncher(launch, active);
  return null;
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

test("launch is a no-op when no provider is mounted", () => {
  const { getByRole } = render(<LaunchButton />);
  // Must not throw: app-shell chrome may render before a pane registers.
  fireEvent.click(getByRole("button", { name: "launch" }));
  expect(getByRole("button", { name: "launch" })).toBeDefined();
});
