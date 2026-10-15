import { toFingerprint } from "@tearleads/crypto";
import { isUserIdentityResponse } from "@tearleads/validators/response";

/** Synthetic MSW fixture for legacy contact-document tests, not a trust test. */
export async function mockIdentityLink(userId: string): Promise<string> {
  const api = "http://localhost:3001";
  const response = await fetch(`${api}/auth/user-identity/${userId}`);
  const identity: unknown = await response.json();
  if (!isUserIdentityResponse(identity))
    throw new Error("Missing mock identity fixture");
  const fingerprint = await toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([
        "tearleads.identity-link.v1",
        api,
        userId,
        "ML-DSA-87",
        identity.signingPublicKey,
        "ML-KEM-1024",
        identity.encapsulationPublicKey,
      ]),
    ),
  );
  const token = Buffer.from(
    JSON.stringify([1, api, userId, fingerprint]),
  ).toString("base64url");
  return `http://localhost/app/contacts/import/${token}`;
}
