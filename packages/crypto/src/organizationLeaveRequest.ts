import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  type OrganizationLeaveRequest,
  OrganizationLeaveRequestSchema,
} from "@tearleads/validators/util";
import { serializeKeyingCanonicalJson } from "./keying/canonical";
import type { SigningKeyPair } from "./signing/generateKeyPair";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

type LeaveRequestPayload = Omit<OrganizationLeaveRequest, "signature">;

export function organizationLeaveRequestSigningBytes(
  payload: LeaveRequestPayload,
): Uint8Array {
  return new TextEncoder().encode(
    serializeKeyingCanonicalJson({
      domain: "tearleads.organization-leave-request.v2",
      membersHead: {
        keyEpoch: payload.membersHead.keyEpoch,
        keyFingerprint: payload.membersHead.keyFingerprint,
        principalId: payload.membersHead.principalId,
        stateHash: payload.membersHead.stateHash,
        version: payload.membersHead.version,
      },
      organizationId: payload.organizationId,
      requestedAt: payload.requestedAt,
      userId: payload.userId,
    }),
  );
}

/** Signs a member's request to leave one organization. */
export function signOrganizationLeaveRequest(
  payload: LeaveRequestPayload,
  keys: Pick<SigningKeyPair, "signingPrivateKey">,
): OrganizationLeaveRequest {
  return OrganizationLeaveRequestSchema.parse({
    ...payload,
    signature: bytesToBase64(
      sign(
        organizationLeaveRequestSigningBytes(payload),
        keys.signingPrivateKey,
      ),
    ),
  });
}

/**
 * Whether `value` is a well-formed leave request signed by the holder of
 * `publicKey`. Callers still check that it names the organization and member
 * they expect, and that the member has stayed in Members since the cited head.
 */
export function isValidOrganizationLeaveRequest(
  value: unknown,
  publicKey: Uint8Array,
): value is OrganizationLeaveRequest {
  const parsed = OrganizationLeaveRequestSchema.safeParse(value);
  if (!parsed.success) return false;
  let signature: Uint8Array;
  try {
    signature = base64ToBytes(parsed.data.signature);
  } catch {
    return false;
  }
  return verify(
    signature,
    organizationLeaveRequestSigningBytes(parsed.data),
    publicKey,
  );
}
