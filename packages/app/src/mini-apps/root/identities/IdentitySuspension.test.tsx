import { expect, spyOn, test } from "bun:test";
import type { RootIdentity } from "@tearleads/client-sdk";
import { fireEvent, render, waitFor } from "@testing-library/react";
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
      <IdentitySuspension
        identity={{ ...ROOT_IDENTITY, suspendedAt: "2026-09-07T12:00:00.000Z" }}
        onChanged={() => undefined}
      />,
    );
    expect(view.queryByRole("button", { name: "Suspend account" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Lift suspension" }));
    await waitFor(() => {
      expect(lifted).toEqual([ROOT_IDENTITY.userId]);
    });

    view.rerender(
      <IdentitySuspension
        identity={ROOT_IDENTITY}
        onChanged={() => undefined}
      />,
    );
    expect(view.queryByRole("button")).toBeNull();
  } finally {
    spy.mockRestore();
  }
});
