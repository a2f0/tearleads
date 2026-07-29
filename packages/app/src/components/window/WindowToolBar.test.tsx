import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type ReactNode, useMemo } from "react";
import {
  useWindowBackAction,
  useWindowTitleBarAction,
  useWindowToolbarReservation,
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

function ReservationSource() {
  useWindowToolbarReservation();
  return null;
}

test("reserves a blank toolbar row when reservation is registered without actions", async () => {
  const view = renderToolBar(<ReservationSource />);

  // The row appears once the reservation registers, even with no actions...
  await waitFor(() => {
    expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
  });

  // ...and stays blank: no back control and no action buttons.
  expect(view.container.querySelector(".window-toolbar-button")).toBeNull();
});

function OptionalReservationSource({ reserve }: { reserve: boolean }) {
  useWindowToolbarReservation(reserve);
  return null;
}

test("toggling the reservation flag adds then releases the blank row", async () => {
  function Harness({ reserve }: { reserve: boolean }) {
    return (
      <WindowMenuProvider>
        <OptionalReservationSource reserve={reserve} />
        <WindowToolBar />
      </WindowMenuProvider>
    );
  }

  // reserve=false with no chrome: the row is absent.
  const view = render(<Harness reserve={false} />);
  expect(view.container.querySelector(".window-toolbar")).toBeNull();

  // Reserving mounts the blank row...
  view.rerender(<Harness reserve />);
  await waitFor(() => {
    expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
  });

  // ...and releasing it (no chrome ever shown, so nothing latches) collapses it.
  view.rerender(<Harness reserve={false} />);
  await waitFor(() => {
    expect(view.container.querySelector(".window-toolbar")).toBeNull();
  });
});

test("explicit reservation release collapses a previously latched row", async () => {
  function Harness({
    reserve,
    showAction,
  }: {
    reserve: boolean;
    showAction: boolean;
  }) {
    return (
      <WindowMenuProvider>
        <OptionalReservationSource reserve={reserve} />
        {showAction ? <TitleBarActionSource onClick={() => undefined} /> : null}
        <WindowToolBar />
      </WindowMenuProvider>
    );
  }

  const view = render(<Harness reserve showAction />);
  await waitFor(() => {
    expect(view.getByRole("button", { name: "Get Info" })).toBeTruthy();
  });

  view.rerender(<Harness reserve={false} showAction={false} />);
  await waitFor(() => {
    expect(view.container.querySelector(".window-toolbar")).toBeNull();
  });
});

test("keeps the row reserved after its actions clear", async () => {
  // Once an app has shown toolbar chrome, a sub-route or loading tick that clears
  // every action must not collapse the row — dropping a bar-height out of the flex
  // column shifts the body up and back down (the layout shift we are preventing).
  function Harness({ show }: { show: boolean }) {
    return (
      <WindowMenuProvider>
        {show ? <TitleBarActionSource onClick={() => undefined} /> : null}
        <WindowToolBar />
      </WindowMenuProvider>
    );
  }

  const view = render(<Harness show />);
  await waitFor(() => {
    expect(view.getByRole("button", { name: "Get Info" })).toBeTruthy();
  });

  view.rerender(<Harness show={false} />);
  await waitFor(() => {
    expect(view.queryByRole("button", { name: "Get Info" })).toBeNull();
  });

  // The action is gone but the row stays mounted, holding its min-height.
  expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
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

// Windows carry their own Back stack (WindowEntry.miniAppRouteHistory) because
// they are not backed by browser history. A window hosting a routed mini-app
// shows the same Back affordance the routed app bar does.
test("shows a history Back caret for a window hosting a routed mini-app", async () => {
  const wentBack: number[] = [];
  const view = render(
    <WindowMenuProvider>
      <WindowToolBar
        canGoBack
        showHistoryBack
        onGoBack={() => wentBack.push(1)}
      />
    </WindowMenuProvider>,
  );

  const back = await view.findByRole("button", { name: "Back" });
  expect((back as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(back);

  expect(wentBack).toEqual([1]);
});

test("omits the history Back caret when the stack is empty", () => {
  const view = render(
    <WindowMenuProvider>
      <WindowToolBar showHistoryBack onGoBack={() => undefined} />
    </WindowMenuProvider>,
  );

  expect(view.queryByRole("button", { name: "Back" })).toBeNull();
  expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
});

test("keeps the toolbar row while history Back appears and disappears", () => {
  function Harness({ canGoBack }: { canGoBack: boolean }) {
    return (
      <WindowMenuProvider>
        <WindowToolBar
          canGoBack={canGoBack}
          showHistoryBack
          onGoBack={() => undefined}
        />
      </WindowMenuProvider>
    );
  }

  const view = render(<Harness canGoBack={false} />);
  expect(view.queryByRole("button", { name: "Back" })).toBeNull();
  expect(view.container.querySelector(".window-toolbar")).not.toBeNull();

  view.rerender(<Harness canGoBack />);
  expect(view.getByRole("button", { name: "Back" })).toBeTruthy();

  view.rerender(<Harness canGoBack={false} />);
  expect(view.queryByRole("button", { name: "Back" })).toBeNull();
  expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
});

test("omits the history Back caret for a window hosting no routed mini-app", () => {
  const view = renderToolBar(null);

  expect(view.container.querySelector(".window-toolbar")).toBeNull();
});

// A registered detail back action outranks the history caret, exactly as it does
// in RoutedPaneAppBar — one Back button, the registered action wins.
test("a registered back action overrides the history caret", async () => {
  const registered: number[] = [];
  const wentBack: number[] = [];
  const view = render(
    <WindowMenuProvider>
      <BackActionSource onClick={() => registered.push(1)} />
      <WindowToolBar
        canGoBack
        showHistoryBack
        onGoBack={() => wentBack.push(1)}
      />
    </WindowMenuProvider>,
  );

  const back = await view.findByRole("button", { name: "Back to Container" });
  fireEvent.click(back);

  expect(registered).toEqual([1]);
  expect(wentBack).toEqual([]);
});
