import { expect, test } from "bun:test";
import {
  isValidOrganizationLeaveRequest,
  signOrganizationLeaveRequest,
} from "./organizationLeaveRequest";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";

const membersHead = {
  keyEpoch: 3,
  keyFingerprint: "members-key-3",
  principalId: "3c1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b",
  stateHash: "members-state-7",
  version: 7,
};

const payload = {
  membersHead,
  organizationId: "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b",
  requestedAt: "2026-10-22T12:00:00.000Z",
  userId: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
};

test("a leave request verifies against its signer's key only", () => {
  const member = generateSigningSeedAndKeyPair();
  const other = generateSigningSeedAndKeyPair();
  const request = signOrganizationLeaveRequest(payload, member);

  expect(
    isValidOrganizationLeaveRequest(request, member.signingPublicKey),
  ).toBe(true);
  expect(isValidOrganizationLeaveRequest(request, other.signingPublicKey)).toBe(
    false,
  );
});

test("a leave request bound to another organization, member, or Members head fails", () => {
  const member = generateSigningSeedAndKeyPair();
  const request = signOrganizationLeaveRequest(payload, member);

  for (const tampered of [
    { ...request, organizationId: "7a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b" },
    { ...request, userId: "2b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e" },
    { ...request, requestedAt: "2026-10-22T12:00:01.000Z" },
    { ...request, membersHead: { ...membersHead, keyEpoch: 2 } },
    { ...request, membersHead: { ...membersHead, version: 6 } },
    {
      ...request,
      membersHead: { ...membersHead, stateHash: "members-state-6" },
    },
    { ...request, signature: "not-base64!" },
    { ...request, extra: true },
  ]) {
    expect(
      isValidOrganizationLeaveRequest(tampered, member.signingPublicKey),
    ).toBe(false);
  }
});
