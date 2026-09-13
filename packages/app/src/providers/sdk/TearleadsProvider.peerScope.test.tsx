import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../logging/LogProvider";
import { SyncModeProvider } from "../sync-mode/SyncModeProvider";
import { TearleadsProvider, useTearleadsRuntime } from "./TearleadsProvider";

afterEach(cleanup);

function PeerScope() {
  return (
    <output data-testid="peer-scope">
      {useTearleadsRuntime().state.peerScope}
    </output>
  );
}

function Runtime({ namespace }: { namespace?: string }) {
  return (
    <AppHostConfigProvider
      value={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        wsUrl: "ws://events.example.test",
        localIdentityNamespace: namespace,
      })}
    >
      <LocalKeyringLockProvider>
        <LogProvider>
          <SyncModeProvider>
            <TearleadsProvider>
              <PeerScope />
            </TearleadsProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>
  );
}

test("ephemeral runtimes never share the CRDT peer and retain it across renders", () => {
  const view = render(
    <>
      <Runtime />
      <Runtime />
    </>,
  );
  const scopes = () =>
    view.getAllByTestId("peer-scope").map((node) => node.textContent);
  const initial = scopes();
  expect(
    initial.every((scope) => typeof scope === "string" && scope.length > 0),
  ).toBe(true);
  expect(initial[0]).not.toBe(initial[1]);
  view.rerender(
    <>
      <Runtime />
      <Runtime />
    </>,
  );
  expect(scopes()).toEqual(initial);
});

test("a persistent runtime uses its acknowledged local namespace for the peer", () => {
  const view = render(<Runtime namespace="pane.left" />);
  expect(view.getByTestId("peer-scope").textContent).toBe("pane.left");
});
