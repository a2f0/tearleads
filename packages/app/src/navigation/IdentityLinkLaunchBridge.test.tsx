import { afterEach, expect, test } from "bun:test";
import {
  LauncherNavigationProvider,
  useWindowStateData,
  WindowStateProvider,
} from "@tearleads/windowing";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IdentityLinkLaunchBridge } from "./IdentityLinkLaunchBridge";

const launcher = {
  apps: { contacts: { title: "Contacts", createComponent: () => () => null } },
};

function Windows({ name }: { name: string }) {
  const { windows } = useWindowStateData();
  return (
    <div data-testid={name}>
      {windows.map((entry) => entry.pathSegments?.join("/")).join(",")}
    </div>
  );
}

function Pane({ active, name }: { active: boolean; name: string }) {
  return (
    <WindowStateProvider>
      <LauncherNavigationProvider
        definition={launcher}
        defaultWindowEnabled={false}
        mode="windowed"
      >
        <IdentityLinkLaunchBridge mode="windowed" enabled={active} />
        <Windows name={name} />
      </LauncherNavigationProvider>
    </WindowStateProvider>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

test("only the active split pane opens an incoming link, including after focus changes", async () => {
  (
    window as typeof window & { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("https://app.test/app/contacts/import/token");
  const view = render(
    <>
      <Pane active name="left" />
      <Pane active={false} name="right" />
    </>,
  );
  await waitFor(() =>
    expect(view.getByTestId("left").textContent).toBe("import/token"),
  );
  expect(view.getByTestId("right").textContent).toBe("");
  view.rerender(
    <>
      <Pane active={false} name="left" />
      <Pane active name="right" />
    </>,
  );
  expect(view.getByTestId("right").textContent).toBe("");
});
