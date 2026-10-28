import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  signOrganizationLeaveRequest,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { TEST_LEAVE_REQUEST_MEMBERS_HEAD } from "../../../../test/helpers/leaveRequestFixtures";
import {
  organizationReadModelDirectory as directory,
  organizationReadModelDirectoryUser as directoryUser,
  organizationReadModelSnapshot as snapshot,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import {
  applyOrganizationReadModelResponse,
  loadOrganizationReadModelProjection,
} from "./organizationReadModelPersistence";

const ORGANIZATION_ID = "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b";
const MEMBER_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const FORGED_ID = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const MISADDRESSED_ID = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";

function leaveRequest(userId: string, keys: SigningKeyPair) {
  return signOrganizationLeaveRequest(
    {
      membersHead: TEST_LEAVE_REQUEST_MEMBERS_HEAD,
      organizationId: ORGANIZATION_ID,
      requestedAt: "2026-10-22T12:00:00.000Z",
      userId,
    },
    keys,
  );
}

test("a directory keeps only leave requests addressed to their row", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-read-model-leave-requests",
  );
  try {
    const member = generateSigningSeedAndKeyPair();
    const server = generateSigningSeedAndKeyPair();
    const publishedKey = bytesToBase64(member.signingPublicKey);
    const genuine = leaveRequest(MEMBER_ID, member);
    const forged = leaveRequest(FORGED_ID, server);
    const base = snapshot(ORGANIZATION_ID, "cursor-1");
    await applyOrganizationReadModelResponse({
      currentUserId: "user-1",
      execSql,
      requestedCursor: null,
      response: {
        ...base,
        lanes: {
          ...base.lanes,
          directory: directory(ORGANIZATION_ID, {
            users: [
              directoryUser("user-1", { isSelf: true }),
              directoryUser(MEMBER_ID, {
                leaveRequest: genuine,
                signingPublicKey: publishedKey,
              }),
              // Its signature is checked when read, against the member's
              // trusted identity, so storing it trusts nothing.
              directoryUser(FORGED_ID, {
                leaveRequest: forged,
                signingPublicKey: publishedKey,
              }),
              // The member's genuine request, served on another member's row.
              directoryUser(MISADDRESSED_ID, {
                leaveRequest: genuine,
                signingPublicKey: publishedKey,
              }),
            ],
          }),
        },
      },
    });

    const projection = await loadOrganizationReadModelProjection(
      execSql,
      ORGANIZATION_ID,
      "user-1",
    );
    const leaveRequests = new Map(
      projection?.directory.users.map((user) => [
        user.userId,
        user.leaveRequest,
      ]),
    );
    expect(leaveRequests.get(MEMBER_ID)).toEqual(genuine);
    expect(leaveRequests.get(FORGED_ID)).toEqual(forged);
    expect(leaveRequests.get(MISADDRESSED_ID)).toBeNull();
  } finally {
    close();
  }
});
