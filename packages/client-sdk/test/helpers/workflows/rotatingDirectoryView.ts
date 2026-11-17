import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

/**
 * A predecessor view under which a directory successor rotates its key, as
 * removing an admin does. These fixtures' organizations have one admin, so
 * the view lists an extra admin the successor's projection omits. The signed
 * successor still names the real predecessor state; only the builder's
 * keep-or-rotate decision sees the extra admin.
 */
export function rotatingDirectoryView<
  Policy extends Pick<PrincipalPolicyBundleResponse, "currentProjection">,
>(policy: Policy): Policy {
  return {
    ...policy,
    currentProjection: [
      ...policy.currentProjection,
      {
        identityBundleFingerprint: "0".repeat(64),
        role: "admin",
        userId: "00000000-0000-4000-8000-000000000000",
      },
    ],
  };
}
