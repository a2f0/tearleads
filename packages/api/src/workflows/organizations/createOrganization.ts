import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
import { base64ToBytes } from "@symcrypt/encoding";
import type { CreateOrganizationRequest } from "@symcrypt/validators/request";
import {
  type CreateOrganizationResponse,
  isCreateOrganizationResponse,
} from "@symcrypt/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import {
  assertOrganizationCanSync,
  OrganizationSyncDisabledError,
} from "../billing/organizationSyncEligibility";
import {
  type OrganizationProvisioningSigner,
  type ProvisionOrganizationOptions,
  provisionOrganizationInTransaction,
  toOrganizationProvisioningError,
} from "./provisionOrganization";
import { OrganizationProvisioningError } from "./provisionOrganizationError";
import { toOrganizationProvisioningResponse } from "./provisionOrganizationResponse";
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
): Promise<CreateOrganizationResponse | null> {
  const replacedOrganizationId = input.replacesOrganizationId;
  if (!replacedOrganizationId) return null;
  if (replacedOrganizationId === input.organizationId) {
    throw new OrganizationProvisioningError(
      "A replacement organization must use a fresh organization id",
      409,
    );
  }
  const billingQuery = tx
    .select({
      replacementOrganizationId: organizationBilling.replacementOrganizationId,
      replacementProvisioningResponse:
        organizationBilling.replacementProvisioningResponse,
      status: organizationBilling.status,
    })
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
  if (billing.replacementOrganizationId !== null) {
    const response = billing.replacementProvisioningResponse;
    if (
      (user?.defaultOrganizationId !== replacedOrganizationId &&
        user?.defaultOrganizationId !== billing.replacementOrganizationId) ||
      !isCreateOrganizationResponse(response) ||
      response.organizationId !== billing.replacementOrganizationId ||
      response.userId !== input.userId
    ) {
      throw new Error(
        "Stored personal organization replacement is inconsistent",
      );
    }
    return response;
  }
  if (user?.defaultOrganizationId !== replacedOrganizationId) {
    throw new OrganizationProvisioningError(
      "Only a purged personal organization can be replaced",
      409,
    );
  }
  return null;
}

async function readNativeRestoreReplay(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
): Promise<CreateOrganizationResponse | null> {
  if (!input.nativeSubscriptionRestore) return null;
  const [billing] = await tx
    .select({
      response: organizationBilling.nativeRestoreProvisioningResponse,
      userId: organizationBilling.nativeRestoreUserId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, input.organizationId))
    .limit(1);
  if (!billing) return null;
  if (
    billing.userId !== input.userId ||
    !isCreateOrganizationResponse(billing.response) ||
    billing.response.organizationId !== input.organizationId ||
    billing.response.rootContainerId !== input.rootContainerId ||
    billing.response.userId !== input.userId
  ) {
    throw new OrganizationProvisioningError(
      "Stored native restore organization is inconsistent",
      409,
    );
  }
  return billing.response;
}

async function markNativeRestoreDestination(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
  response: CreateOrganizationResponse,
): Promise<void> {
  if (!input.nativeSubscriptionRestore) return;
  const [marked] = await tx
    .update(organizationBilling)
    .set({
      nativeRestoreProvisioningResponse: response,
      nativeRestoreUserId: input.userId,
    })
    .where(eq(organizationBilling.organizationId, input.organizationId))
    .returning({ organizationId: organizationBilling.organizationId });
  if (!marked) {
    throw new OrganizationProvisioningError(
      "Native restore organization billing was not provisioned",
      409,
    );
  }
}

async function linkReplacementOrganization(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
  response: CreateOrganizationResponse,
): Promise<void> {
  if (!input.replacesOrganizationId) return;
  const [linked] = await tx
    .update(organizationBilling)
    .set({
      replacementOrganizationId: input.organizationId,
      replacementProvisioningResponse: response,
    })
    .where(
      and(
        eq(organizationBilling.organizationId, input.replacesOrganizationId),
        eq(organizationBilling.status, "purged"),
        isNull(organizationBilling.replacementOrganizationId),
      ),
    )
    .returning({ organizationId: organizationBilling.organizationId });
  if (!linked) {
    throw new OrganizationProvisioningError(
      "The personal organization replacement changed during provisioning",
      409,
    );
  }
}

async function finalizeReplacementDefaultOrganization(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
  response: CreateOrganizationResponse,
): Promise<void> {
  if (!input.finalizeReplacement) return;
  const replacedOrganizationId = input.replacesOrganizationId;
  if (!replacedOrganizationId) {
    throw new OrganizationProvisioningError(
      "Replacement finalization requires a replaced organization",
      400,
    );
  }
  try {
    await assertOrganizationCanSync(tx, response.organizationId, input.userId);
  } catch (error) {
    if (error instanceof OrganizationSyncDisabledError) {
      throw new OrganizationProvisioningError(
        "The replacement organization is not sync eligible",
        409,
      );
    }
    throw error;
  }
  const [updated] = await tx
    .update(users)
    .set({ defaultOrganizationId: response.organizationId })
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.defaultOrganizationId, replacedOrganizationId),
      ),
    )
    .returning({ id: users.id });
  if (updated?.id === input.userId) return;
  const [user] = await tx
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (user?.defaultOrganizationId !== response.organizationId) {
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
): Promise<CreateOrganizationResponse> {
  if (
    input.nativeSubscriptionRestore &&
    (input.finalizeReplacement || input.replacesOrganizationId)
  ) {
    throw new OrganizationProvisioningError(
      "Native restore cannot replace a personal organization",
      400,
    );
  }
  if (input.finalizeReplacement && !input.replacesOrganizationId) {
    throw new OrganizationProvisioningError(
      "Replacement finalization requires a replaced organization",
      400,
    );
  }
  const signer = await readProvisioningSigner(db, input.userId);
  await validateOrganizationProvisioningInput(input, signer);
  try {
    return await db.transaction(async (tx) => {
      const nativeRestoreReplay = await readNativeRestoreReplay(tx, input);
      if (nativeRestoreReplay) return nativeRestoreReplay;
      const existingReplacement = await assertReplacementReady(tx, input);
      if (existingReplacement) {
        await finalizeReplacementDefaultOrganization(
          tx,
          input,
          existingReplacement,
        );
        return existingReplacement;
      }
      const provisioned = await provisionOrganizationInTransaction(
        tx,
        input,
        signer,
        ADDITIONAL_ORGANIZATION_OPTIONS,
      );
      const response = toOrganizationProvisioningResponse(
        input.userId,
        provisioned,
      );
      await markNativeRestoreDestination(tx, input, response);
      await linkReplacementOrganization(tx, input, response);
      await finalizeReplacementDefaultOrganization(tx, input, response);
      return response;
    });
  } catch (error) {
    const provisioningError = toOrganizationProvisioningError(error);
    if (provisioningError) {
      throw provisioningError;
    }
    throw error;
  }
}
