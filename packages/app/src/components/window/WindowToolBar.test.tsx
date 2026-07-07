import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type ReactNode, useMemo } from "react";
import {
  useWindowBackAction,
  useWindowTitleBarAction,
  WindowMenuProvider,
} from "./WindowMenuContext";
import { WindowToolBar } from "./WindowToolBar";

afterEach(() => cleanup());

function renderToolBar(source: ReactNode) {
  return render(
    <WindowMenuProvider>
      {source}
      <WindowToolBar />
    </WindowMenuProvider>,
  );
}

function TitleBarActionSource({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  const action = useMemo(
    () => ({
      disabled,
      icon: <span aria-hidden>i</span>,
      id: "get-info",
      label: "Get Info",
      onClick,
    }),
    [disabled, onClick],
  );
  useWindowTitleBarAction(action);
  return null;
}

function BackActionSource({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  const action = useMemo(
    () => ({ disabled, label: "Back to Container", onClick }),
    [disabled, onClick],
  );
  useWindowBackAction(action);
  return null;
}

test("renders nothing when no actions or back action are registered", () => {
  const view = renderToolBar(null);

  expect(view.container.querySelector(".window-toolbar")).toBeNull();
});

test("renders a registered title-bar action and invokes it on click", async () => {
  let clicks = 0;
  const view = renderToolBar(
    <TitleBarActionSource
      onClick={() => {
        clicks += 1;
      }}
    />,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Get Info" })).toBeTruthy();
  });
  expect(view.container.querySelector(".window-toolbar")).not.toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Get Info" }));

  expect(clicks).toBe(1);
});

test("honors the disabled flag on a registered action", async () => {
  const view = renderToolBar(
    <TitleBarActionSource disabled onClick={() => undefined} />,
  );

  await waitFor(() => {
    expect(
      (view.getByRole("button", { name: "Get Info" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

test("renders the back control from a registered back action and invokes it", async () => {
  let backs = 0;
  const view = renderToolBar(
    <BackActionSource
      onClick={() => {
        backs += 1;
      }}
    />,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
  });

  fireEvent.click(view.getByRole("button", { name: "Back to Container" }));

  expect(backs).toBe(1);
});
