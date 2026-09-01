import { afterEach, expect, mock, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  attachOrganizationReadModelSocket,
  handleOrganizationReadModelInterestAcknowledgement,
} from "../../../providers/sdk/organizationReadModelRealtime";
import { useOrgManagerDirectorySync } from "./useOrgManagerDirectorySync";

afterEach(() => cleanup());

const ORGANIZATION_ID = "00000000-0000-4000-8000-00000000000a";
const USER_ID = "00000000-0000-4000-8000-00000000001a";

test("loads locally offline and establishes reconciliation demand when online", async () => {
  const domainScope = {};
  let runtimeOnline = false;
  const loadDirectoryAndGroups = mock(async () => ({}));
  const tearleads = {
    organizations: {
      loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation: loadDirectoryAndGroups,
    },
    runtime: {
      input: () => ({
        auth: {
          isAuthenticated: true,
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
        },
        infra: { dbStatus: "idle" },
        state: { domainScope, online: runtimeOnline },
      }),
    },
  } as unknown as Tearleads;
  const refreshDirectoryAndGroups = mock(async () => ({
    didLoad: false as const,
    groupId: null,
  }));
  const view = renderHook(
    ({ online }: { readonly online: boolean }) => {
      runtimeOnline = online;
      useOrgManagerDirectorySync({
        canLoadAuthenticatedOrgData: true,
        mutating: false,
        online,
        organizationId: ORGANIZATION_ID,
        refreshDirectoryAndGroups,
        scopeKey: "scope-a",
        tearleads,
      });
    },
    { initialProps: { online: false } },
  );

  await waitFor(() => {
    expect(refreshDirectoryAndGroups).toHaveBeenCalledTimes(1);
  });
  expect(refreshDirectoryAndGroups).toHaveBeenLastCalledWith({
    localOnly: true,
    manageLoading: false,
  });
  expect(loadDirectoryAndGroups).toHaveBeenCalledTimes(0);

  view.rerender({ online: true });
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (message: string) => sent.push(message),
  } as unknown as WebSocket;
  const detach = attachOrganizationReadModelSocket(tearleads, socket);
  const declaration = JSON.parse(sent[0] ?? "null") as {
    declarationId: string;
  };
  handleOrganizationReadModelInterestAcknowledgement(
    tearleads,
    socket,
    declaration.declarationId,
    ORGANIZATION_ID,
    true,
  );
  await waitFor(() => {
    expect(loadDirectoryAndGroups).toHaveBeenCalledTimes(1);
    expect(refreshDirectoryAndGroups).toHaveBeenCalledTimes(2);
  });
  expect(refreshDirectoryAndGroups).toHaveBeenLastCalledWith({
    clearError: true,
    localOnly: true,
    manageLoading: false,
  });
  detach();
});
