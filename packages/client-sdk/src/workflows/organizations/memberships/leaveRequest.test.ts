import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  isValidOrganizationLeaveRequest,
} from "@tearleads/crypto";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import { TEST_LEAVE_REQUEST_MEMBERS_HEAD as MEMBERS_HEAD } from "../../../../test/helpers/leaveRequestFixtures";
import {
  type OrganizationLeaveRequestApi,
  setOrganizationLeaveRequested,
} from "./leaveRequest";

const ORGANIZATION_ID = "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b";
const USER_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const REQUESTED_AT = new Date("2026-10-22T12:00:00.000Z");
const loadMembersHead = async () => MEMBERS_HEAD;

function recordingApi(ok = true) {
  const sent: Array<OrganizationLeaveRequest | null> = [];
  const apiClient: OrganizationLeaveRequestApi = {
    async setOrganizationLeaveRequest(organizationId, request) {
      sent.push(request);
      return ok
        ? {
            data: {
              isPersonalOrganizationOwner: false,
              leaveRequestedAt: request?.requestedAt ?? null,
              organizationId,
              syncPaused: false,
            },
            ok: true,
          }
        : {
            kind: "http",
            message: "Sole administrator",
            method: "PUT",
            ok: false,
            path: `/organization-memberships/${organizationId}/leave-request`,
            report: () => undefined,
            status: 409,
            statusText: "Conflict",
          };
    },
  };
  return { apiClient, sent };
}

test("asking to leave sends a request the member's key verifies", async () => {
  const keys = generateSigningSeedAndKeyPair();
  const { apiClient, sent } = recordingApi();

  const result = await setOrganizationLeaveRequested({
    apiClient,
    loadMembersHead,
    now: () => REQUESTED_AT,
    organizationId: ORGANIZATION_ID,
    requested: true,
    signer: { signingKeyPair: keys, userId: USER_ID },
  });

  expect(result.status).toBe("updated");
  const [request] = sent;
  expect(request).toMatchObject({
    membersHead: MEMBERS_HEAD,
    organizationId: ORGANIZATION_ID,
    requestedAt: REQUESTED_AT.toISOString(),
    userId: USER_ID,
  });
  expect(isValidOrganizationLeaveRequest(request, keys.signingPublicKey)).toBe(
    true,
  );
});

test("withdrawing sends no request, and a refusal reports the server's reason", async () => {
  const keys = generateSigningSeedAndKeyPair();
  const accepted = recordingApi();
  await setOrganizationLeaveRequested({
    apiClient: accepted.apiClient,
    loadMembersHead: async () => {
      throw new Error("withdrawing cites no membership");
    },
    organizationId: ORGANIZATION_ID,
    requested: false,
    signer: { signingKeyPair: keys, userId: USER_ID },
  });
  expect(accepted.sent).toEqual([null]);

  const refused = recordingApi(false);
  expect(
    await setOrganizationLeaveRequested({
      apiClient: refused.apiClient,
      loadMembersHead,
      organizationId: ORGANIZATION_ID,
      requested: true,
      signer: { signingKeyPair: keys, userId: USER_ID },
    }),
  ).toEqual({
    httpStatus: 409,
    message: "Sole administrator",
    status: "failed",
  });
});

test("a membership this device cannot confirm sends no request", async () => {
  const keys = generateSigningSeedAndKeyPair();
  const { apiClient, sent } = recordingApi();

  const result = await setOrganizationLeaveRequested({
    apiClient,
    loadMembersHead: async () => {
      throw new Error("offline");
    },
    organizationId: ORGANIZATION_ID,
    requested: true,
    signer: { signingKeyPair: keys, userId: USER_ID },
  });

  expect(result.status).toBe("failed");
  expect(sent).toEqual([]);
});
