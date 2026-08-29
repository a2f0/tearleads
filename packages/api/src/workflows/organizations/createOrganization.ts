import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
import { base64ToBytes } from "@symcrypt/encoding";
import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import { and, eq } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
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

async function assertReplacementReady(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
): Promise<void> {
  const replacedOrganizationId = input.replacesOrganizationId;
  if (!replacedOrganizationId) return;
  if (replacedOrganizationId === input.organizationId) {
    throw new OrganizationProvisioningError(
      "A replacement organization must use a fresh organization id",
      409,
    );
  }
  const billingQuery = tx
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, replacedOrganizationId))
    .limit(1);
  const [billing] = await lockRowForUpdate(billingQuery);
  if (!billing || billing.status !== "purged") {
    throw new OrganizationProvisioningError(
      "The replaced organization's remote data purge is not complete",
      409,
    );
  }
  const userQuery = tx
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const [user] = await lockRowForUpdate(userQuery);
  if (user?.defaultOrganizationId !== replacedOrganizationId) {
    throw new OrganizationProvisioningError(
      "Only a purged personal organization can be replaced",
      409,
    );
  }
}

async function moveDefaultOrganizationToReplacement(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
): Promise<void> {
  if (!input.replacesOrganizationId) return;
  const [updated] = await tx
    .update(users)
    .set({ defaultOrganizationId: input.organizationId })
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.defaultOrganizationId, input.replacesOrganizationId),
      ),
    )
    .returning({ id: users.id });
  if (!updated || updated.id !== input.userId) {
    throw new OrganizationProvisioningError(
      "The personal organization changed during replacement",
      409,
    );
  }
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
  await validateOrganizationProvisioningInput(input, signer);
  try {
    return await db.transaction(async (tx) => {
      await assertReplacementReady(tx, input);
      const provisioned = await provisionOrganizationInTransaction(
        tx,
        input,
        signer,
        ADDITIONAL_ORGANIZATION_OPTIONS,
      );
      await moveDefaultOrganizationToReplacement(tx, input);
      return provisioned;
    });
  } catch (error) {
    const provisioningError = toOrganizationProvisioningError(error);
    if (provisioningError) {
      throw provisioningError;
    }
    throw error;
  }
}
