import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  signOrganizationLeaveRequest,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { organizationReadModelDirectoryUser as directoryUser } from "../../../test/helpers/organizationReadModelPersistenceFixtures";
import { createTestTrustedUserIdentity } from "../../data/trustedUserIdentity/testFixtures";
import type { ContainerContents } from "../containerContents";
import { createOrganizations } from ".";

const ORGANIZATION_ID = "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b";
const MEMBER_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

test("a roster update response cannot carry a forged leave request", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-roster-update-leave-request",
  );
  try {
    const member = generateSigningSeedAndKeyPair();
    const server = generateSigningSeedAndKeyPair();
    // The server answers a profile update with a request it signed itself,
    // beside its own key in place of the member's.
    const forged = signOrganizationLeaveRequest(
      {
        organizationId: ORGANIZATION_ID,
        requestedAt: "2026-10-22T12:00:00.000Z",
        userId: MEMBER_ID,
      },
      server,
    );
    const apiClient = createMockApiClient({
      updateOrganizationRosterEntry: async () =>
        directoryUser(MEMBER_ID, {
          leaveRequest: forged,
          signingPublicKey: bytesToBase64(server.signingPublicKey),
        }),
    });
    const runtime = createInternalRuntimeFixture(() =>
      createWorkflowInputFixture({
        apiClient,
        auth: { organizationId: ORGANIZATION_ID, userId: "admin" },
        execSql,
      }),
    );
    // This device pinned the member's real key when it first trusted them.
    const pinned = createTestTrustedUserIdentity({
      signingKeyFingerprint: "member-fingerprint",
      signingPublicKey: member.signingPublicKey,
      userId: MEMBER_ID,
    });
    Object.assign(runtime.identityLinks, {
      resolvePinned: async (userId: string) =>
        userId === MEMBER_ID ? pinned : null,
    });
    const organizations = createOrganizations(
      runtime,
      {} as ContainerContents,
      () => {
        throw new Error("No organization is resumed in this test");
      },
    );

    const user = await organizations.updateRosterEntry(MEMBER_ID, "profile");

    expect(user?.userId).toBe(MEMBER_ID);
    expect(user?.leaveRequest).toBeNull();
  } finally {
    close();
  }
});

test("a request the member signed verifies against the pin while offline", async () => {
  const { close, execSql } = await createTestExecSql(
    "organizations-roster-update-leave-request-offline",
  );
  try {
    const member = generateSigningSeedAndKeyPair();
    const genuine = signOrganizationLeaveRequest(
      {
        organizationId: ORGANIZATION_ID,
        requestedAt: "2026-10-22T12:00:00.000Z",
        userId: MEMBER_ID,
      },
      member,
    );
    const runtime = createInternalRuntimeFixture(() =>
      createWorkflowInputFixture({
        apiClient: createMockApiClient({
          updateOrganizationRosterEntry: async () =>
            directoryUser(MEMBER_ID, { leaveRequest: genuine }),
        }),
        auth: { organizationId: ORGANIZATION_ID, userId: "admin" },
        execSql,
        // Remote identity resolution is unreachable.
        resolveTrustedUserIdentity: async () => {
          throw new Error("offline");
        },
      }),
    );
    const pinned = createTestTrustedUserIdentity({
      signingKeyFingerprint: "member-fingerprint",
      signingPublicKey: member.signingPublicKey,
      userId: MEMBER_ID,
    });
    Object.assign(runtime.identityLinks, {
      resolvePinned: async (userId: string) =>
        userId === MEMBER_ID ? pinned : null,
    });
    const organizations = createOrganizations(
      runtime,
      {} as ContainerContents,
      () => {
        throw new Error("No organization is resumed in this test");
      },
    );

    const user = await organizations.updateRosterEntry(MEMBER_ID, "profile");

    expect(user?.leaveRequest).toEqual(genuine);
  } finally {
    close();
  }
});
