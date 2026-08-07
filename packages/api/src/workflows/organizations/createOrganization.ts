import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { base64ToBytes } from "@tearleads/encoding";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import {
  type OrganizationProvisioningSigner,
  type ProvisionedOrganization,
  type ProvisionOrganizationOptions,
  provisionOrganizationInTransaction,
  toOrganizationProvisioningError,
} from "./provisionOrganization";
import { OrganizationProvisioningError } from "./provisionOrganizationError";
import { validateOrganizationProvisioningInput } from "./provisionOrganizationValidation";

/**
 * Server-side label for an organization created after registration. The real
 * display name lives in the encrypted organization profile document, so the
 * database label is only a coarse placeholder.
 */
const ADDITIONAL_ORGANIZATION_OPTIONS: ProvisionOrganizationOptions = {
  initialBilling: "local",
  organizationName: "Organization",
};

/**
 * Resolves the founding admin's stored key material into an
 * {@link OrganizationProvisioningSigner}. Unlike registration (which receives
 * fresh keys on the wire), an additional organization is signed with the
 * caller's existing identity, so the signer is reconstructed from the `users`
 * row rather than the request body.
 */
async function readProvisioningSigner(
  db: ApiDatabase,
  userId: string,
): Promise<OrganizationProvisioningSigner> {
  const [user] = await db
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new OrganizationProvisioningError("User not found", 404);
  }
  return {
    encapsulationFingerprint: user.encapsulationKeyFingerprint,
    fingerprint: user.fingerprint,
    signingPublicKey: base64ToBytes(user.signingPublicKey),
  };
}

/**
 * Provisions an additional organization for an already-registered user. Shares
 * the whole bootstrap sequence with registration via
 * {@link provisionOrganizationInTransaction}; the only difference is that the
 * founding user already exists, so no user row is created and the signer is
 * loaded from storage.
 */
export async function runCreateOrganizationWorkflow(
  db: ApiDatabase,
  input: CreateOrganizationRequest,
): Promise<ProvisionedOrganization> {
  const signer = await readProvisioningSigner(db, input.userId);
  validateOrganizationProvisioningInput(input, signer);
  try {
    return await db.transaction((tx) =>
      provisionOrganizationInTransaction(
        tx,
        input,
        signer,
        ADDITIONAL_ORGANIZATION_OPTIONS,
      ),
    );
  } catch (error) {
    const provisioningError = toOrganizationProvisioningError(error);
    if (provisioningError) {
      throw provisioningError;
    }
    throw error;
  }
}
