import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  OrganizationLeaveRequestResult,
  OrganizationMembership,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useOrganizationSyncChoices } from "./useOrganizationSyncChoices";

afterEach(() => cleanup());

const ORGANIZATION_ID = "org-shared";

function membership(leaveRequestedAt: string | null): OrganizationMembership {
  return {
    isPersonalOrganizationOwner: false,
    leaveRequestedAt,
    organizationId: ORGANIZATION_ID,
    syncPaused: false,
  };
}

function runtimeIn(domainScope: object): RuntimeSnapshot {
  return { state: { domainScope } } as unknown as RuntimeSnapshot;
}

test("a leave request that settles after an identity switch changes nothing", async () => {
  let settleLeave: (result: OrganizationLeaveRequestResult) => void = () => {};
  const listeners = new Set<(list: OrganizationMembership[]) => void>();
  const memberships = {
    loadPausedOrganizationIds: async () => new Set<string>(),
    refresh: async () => {
      for (const listener of listeners) listener([membership(null)]);
      return [membership(null)];
    },
    setLeaveRequested: () =>
      new Promise<OrganizationLeaveRequestResult>((resolve) => {
        settleLeave = resolve;
      }),
    subscribeToMemberships: (
      listener: (list: OrganizationMembership[]) => void,
    ) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeToSyncPauses: () => () => undefined,
  };
  const tearleads = {
    organizations: { memberships },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>;
  let runtime = runtimeIn({});
  const tearleadsSpy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue(
    tearleads,
  );
  const runtimeSpy = spyOn(
    TearleadsProvider,
    "useTearleadsRuntime",
  ).mockImplementation(() => runtime);

  try {
    const view = renderHook(() => useOrganizationSyncChoices());
    await waitFor(() => expect(view.result.current.memberships).not.toBeNull());

    // The first identity asks to leave; its response is still in flight when
    // the session switches to another identity.
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = view.result.current.setLeaveRequested(ORGANIZATION_ID, true);
    });
    runtime = runtimeIn({});
    view.rerender();
    await waitFor(() => expect(view.result.current.memberships).not.toBeNull());

    await act(async () => {
      settleLeave({
        membership: membership("2026-10-22T12:00:00.000Z"),
        status: "updated",
      });
      await pending;
    });

    expect(
      view.result.current.memberships?.get(ORGANIZATION_ID)?.leaveRequestedAt,
    ).toBeNull();
    expect(view.result.current.changingOrganizationId).toBeNull();
  } finally {
    tearleadsSpy.mockRestore();
    runtimeSpy.mockRestore();
  }
});
