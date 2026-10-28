import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  signOrganizationLeaveRequest,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { TEST_LEAVE_REQUEST_MEMBERS_HEAD } from "../../../../test/helpers/leaveRequestFixtures";
import {
  organizationReadModelDirectory as directory,
  organizationReadModelDirectoryUser as directoryUser,
} from "../../../../test/helpers/organizationReadModelPersistenceFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../data/trustedUserIdentity/testFixtures";
import type { OrganizationDirectoryAndGroups } from "../readModel";
import type { LeaveRequestMembershipCheck } from "./leaveRequestMembership";
import { withVerifiedLeaveRequests } from "./leaveRequestVerification";

const ORGANIZATION_ID = "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b";
const MEMBER_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

function leaveRequest(keys: SigningKeyPair) {
  return signOrganizationLeaveRequest(
    {
      membersHead: TEST_LEAVE_REQUEST_MEMBERS_HEAD,
      organizationId: ORGANIZATION_ID,
      requestedAt: "2026-10-22T12:00:00.000Z",
      userId: MEMBER_ID,
    },
    keys,
  );
}

function directoryWith(
  request: ReturnType<typeof leaveRequest>,
  servedKey: SigningKeyPair,
): OrganizationDirectoryAndGroups {
  return {
    directory: {
      ...directory(ORGANIZATION_ID, {
        users: [
          directoryUser(MEMBER_ID, {
            leaveRequest: request,
            signingPublicKey: bytesToBase64(servedKey.signingPublicKey),
          }),
        ],
      }),
      currentUser: { isOrgAdmin: true },
    },
    groups: [],
    memberGroupId: "members",
    readModelCursor: "cursor-1",
  };
}

const member = generateSigningSeedAndKeyPair();
const trustedMember = createTestTrustedUserIdentityResolver({
  signingKeyFingerprint: "member-fingerprint",
  signingPublicKey: member.signingPublicKey,
  userId: MEMBER_ID,
});

async function shownRequest(
  result: OrganizationDirectoryAndGroups,
  resolveTrustedUserIdentity = trustedMember,
  membershipIsCurrent: LeaveRequestMembershipCheck = async () => true,
) {
  return (
    await withVerifiedLeaveRequests(result, {
      membershipIsCurrent,
      resolveTrustedUserIdentity,
    })
  )?.directory.users[0]?.leaveRequest;
}

test("a request the member signed is shown", async () => {
  const genuine = leaveRequest(member);
  expect(await shownRequest(directoryWith(genuine, member))).toEqual(genuine);
});

test("a server that swaps the served key and the signature cannot forge one", async () => {
  const server = generateSigningSeedAndKeyPair();
  // The forged request verifies against the key served beside it, but not
  // against the member's trusted identity.
  expect(
    await shownRequest(directoryWith(leaveRequest(server), server)),
  ).toBeNull();
});

test("a request whose member cannot be trusted yet is not shown", async () => {
  expect(
    await shownRequest(
      directoryWith(leaveRequest(member), member),
      async () => null,
    ),
  ).toBeNull();
});

test("a signed request from a membership that has since ended is not shown", async () => {
  const genuine = leaveRequest(member);
  expect(
    await shownRequest(
      directoryWith(genuine, member),
      trustedMember,
      async (request) => request !== genuine,
    ),
  ).toBeNull();
});
