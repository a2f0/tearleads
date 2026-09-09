import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import * as Identity from "../identity/IdentityProvider";
import { DiagnosticsIdentityReset } from "./DiagnosticsIdentityReset";

afterEach(cleanup);

test("switching or locking identity clears the remote trail without passing identifiers", () => {
  let fingerprint: string | null = "private-first-identity";
  const identity = spyOn(Identity, "useIdentity").mockImplementation(
    () =>
      ({ signingFingerprint: fingerprint }) as Identity.IdentityContextValue,
  );
  const clears: unknown[][] = [];
  const config = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    wsUrl: "ws://localhost",
    diagnostics: {
      addBreadcrumb: () => {},
      captureError: () => {},
      clearBreadcrumbs: (...args) => {
        clears.push(args);
      },
    },
  });
  function View() {
    return (
      <AppHostConfigProvider value={config}>
        <DiagnosticsIdentityReset />
      </AppHostConfigProvider>
    );
  }
  try {
    const view = render(<View />);
    fingerprint = "private-second-identity";
    view.rerender(<View />);
    fingerprint = null;
    view.rerender(<View />);
    expect(clears).toEqual([[], [], []]);
  } finally {
    identity.mockRestore();
  }
});
