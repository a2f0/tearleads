import {
  type PrincipalPolicyHistoryProgressOptions,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";

/** Stable authenticated scopes shared by paged recovery and acknowledged extension. */
export function directoryHistoryProtection(
  protection: PrincipalPolicyHistoryProgressOptions,
) {
  return {
    localKey: protection.localKey,
    context: serializeKeyingCanonicalJson([
      "tearleads.sdk.principal-history.directory.v1",
      protection.context,
    ]),
  };
}

export function scopedGroupHistoryProtection(
  protection: PrincipalPolicyHistoryProgressOptions,
  organizationId: string,
  adminGroupId: string,
) {
  return {
    localKey: protection.localKey,
    context: serializeKeyingCanonicalJson([
      "tearleads.sdk.principal-history.scoped-group.v1",
      protection.context,
      organizationId,
      adminGroupId,
    ]),
  };
}
