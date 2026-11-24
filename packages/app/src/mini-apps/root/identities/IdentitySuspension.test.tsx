import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { RootIdentity } from "@tearleads/client-sdk";
import { WindowMenuProvider, WindowToolBar } from "@tearleads/windowing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { IdentitySuspension } from "./IdentitySuspension";

const ROOT_IDENTITY: RootIdentity = {
  createdAt: "2026-08-01T00:00:00.000Z",
  defaultOrganizationId: "33333333-3333-4333-8333-333333333333",
  isRoot: true,
  lastActiveAt: null,
  registrationSourceIpAddress: null,
  signingKeyFingerprint: "a".repeat(64),
  suspendedAt: null,
  userId: "11111111-1111-4111-8111-111111111111",
};

// The preload does not unmount between files, and a toolbar left behind would
// be found by the next file's toolbar queries.
afterEach(cleanup);

// Suspension is a window toolbar action, so render it under a toolbar.
function inToolbar(identity: RootIdentity) {
  return (
    <WindowMenuProvider>
      <WindowToolBar />
      <IdentitySuspension identity={identity} onChanged={() => undefined} />
    </WindowMenuProvider>
  );
}

test("a root identity left suspended can still be lifted but never suspended", async () => {
  const lifted: string[] = [];
  const spy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    root: {
      liftIdentitySuspension: async (userId: string) => {
        lifted.push(userId);
        return { data: { ...ROOT_IDENTITY, suspendedAt: null }, ok: true };
      },
    },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>);
  try {
    const view = render(
      inToolbar({ ...ROOT_IDENTITY, suspendedAt: "2026-09-07T12:00:00.000Z" }),
    );
    expect(view.queryByRole("button", { name: "Suspend account" })).toBeNull();
    fireEvent.click(
      within(view.getByRole("toolbar")).getByRole("button", {
        name: "Lift suspension",
      }),
    );
    await waitFor(() => {
      expect(lifted).toEqual([ROOT_IDENTITY.userId]);
    });

    view.rerender(inToolbar(ROOT_IDENTITY));
    expect(view.queryByRole("button")).toBeNull();
  } finally {
    spy.mockRestore();
  }
});

test("Lift suspension reads Lifting... and is disabled until the lift settles", async () => {
  type Lifted = { data: RootIdentity; ok: true };
  const held = Promise.withResolvers<Lifted>();
  const spy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    root: { liftIdentitySuspension: () => held.promise },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>);
  try {
    const view = render(
      inToolbar({ ...ROOT_IDENTITY, suspendedAt: "2026-09-07T12:00:00.000Z" }),
    );
    const toolbar = within(view.getByRole("toolbar"));
    fireEvent.click(toolbar.getByRole("button", { name: "Lift suspension" }));
    const lifting = toolbar.getByRole("button", { name: "Lifting..." });
    expect((lifting as HTMLButtonElement).disabled).toBe(true);

    await act(async () =>
      held.resolve({ data: { ...ROOT_IDENTITY, suspendedAt: null }, ok: true }),
    );
    const lift = toolbar.getByRole("button", { name: "Lift suspension" });
    expect((lift as HTMLButtonElement).disabled).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

const MEMBER: RootIdentity = { ...ROOT_IDENTITY, isRoot: false };
const SUSPENDED = { ...MEMBER, suspendedAt: "2026-09-07T12:00:00.000Z" };
type Outcome =
  | { data: RootIdentity; ok: true }
  | { message: string; ok: false; status: number | null };

/**
 * Stubs the root client with held suspend and lift calls, one mock per
 * endpoint so a test can tell which one an action reached and with which user.
 */
function holdRootChanges() {
  const pending: Array<PromiseWithResolvers<Outcome>> = [];
  const hold = (_userId: string) => {
    const call = Promise.withResolvers<Outcome>();
    pending.push(call);
    return call.promise;
  };
  const lift = mock(hold);
  const suspend = mock(hold);
  const spy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    root: { liftIdentitySuspension: lift, suspendIdentity: suspend },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>);
  return { lift, pending, spy, suspend };
}

test("two clicks in one batch start one lift", async () => {
  const { lift, pending, spy, suspend } = holdRootChanges();
  try {
    const view = render(inToolbar(SUSPENDED));
    const action = within(view.getByRole("toolbar")).getByRole("button", {
      name: "Lift suspension",
    });
    // Both clicks land before React renders the action disabled.
    act(() => {
      action.click();
      action.click();
    });
    expect(lift).toHaveBeenCalledTimes(1);
    expect(lift).toHaveBeenCalledWith(MEMBER.userId);
    expect(suspend).not.toHaveBeenCalled();
    await act(async () => pending[0]?.resolve({ data: MEMBER, ok: true }));
  } finally {
    spy.mockRestore();
  }
});

test("two submits in one batch start one suspension", async () => {
  const { lift, pending, spy, suspend } = holdRootChanges();
  try {
    const view = render(inToolbar(MEMBER));
    fireEvent.click(
      within(view.getByRole("toolbar")).getByRole("button", {
        name: "Suspend account",
      }),
    );
    const confirm = within(view.getByRole("dialog")).getByRole("button", {
      name: "Suspend",
    });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenCalledWith(MEMBER.userId);
    expect(lift).not.toHaveBeenCalled();
    await act(async () => pending[0]?.resolve({ data: SUSPENDED, ok: true }));
  } finally {
    spy.mockRestore();
  }
});

test("a suspension keeps its dialog open while it runs, then closes showing a failure that Cancel keeps", async () => {
  const { pending, spy } = holdRootChanges();
  try {
    const view = render(inToolbar(MEMBER));
    const toolbar = within(view.getByRole("toolbar"));
    const ask = () =>
      fireEvent.click(toolbar.getByRole("button", { name: "Suspend account" }));
    ask();
    fireEvent.click(
      within(view.getByRole("dialog")).getByRole("button", { name: "Suspend" }),
    );
    const dialog = within(view.getByRole("dialog"));
    expect(
      (
        dialog.getByRole("button", {
          name: "Suspending...",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (dialog.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        toolbar.getByRole("button", {
          name: "Suspend account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () =>
      pending[0]?.resolve({
        message: "Suspension denied",
        ok: false,
        status: 409,
      }),
    );
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByText("Suspension denied")).toBeTruthy();

    ask();
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(view.getByText("Suspension denied")).toBeTruthy();
    fireEvent.click(
      within(view.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByText("Suspension denied")).toBeTruthy();
  } finally {
    spy.mockRestore();
  }
});
