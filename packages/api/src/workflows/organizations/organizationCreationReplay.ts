import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import {
  type CreateOrganizationResponse,
  isCreateOrganizationResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { sha256Hex } from "../../utils/sha256";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

function isOrdinaryCreate(input: CreateOrganizationRequest): boolean {
  return !input.replacesOrganizationId && !input.nativeSubscriptionRestore;
}

function requestSha256(input: CreateOrganizationRequest): string {
  return sha256Hex(
    `tearleads.organization-provisioning-request.v1\0${serializeKeyingCanonicalJson(
      readKeyingCanonicalJson(input, "organization provisioning request"),
    )}`,
  );
}

/** Call only after signer validation and while holding the organization lock. */
export async function readOrganizationCreationReplay(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
): Promise<CreateOrganizationResponse | null> {
  if (!isOrdinaryCreate(input)) return null;
  const [stored] = await tx
    .select({
      userId: organizations.provisioningUserId,
      requestSha256: organizations.provisioningRequestSha256,
      response: organizations.provisioningResponse,
      billingStatus: organizationBilling.status,
      rosterStatus: organizationRosterEntries.status,
    })
    .from(organizations)
    .leftJoin(
      organizationBilling,
      eq(organizationBilling.organizationId, organizations.id),
    )
    .leftJoin(
      organizationRosterEntries,
      and(
        eq(organizationRosterEntries.organizationId, organizations.id),
        eq(organizationRosterEntries.userId, input.userId),
      ),
    )
    .where(eq(organizations.id, input.organizationId));
  if (!stored) return null;
  if (
    stored.userId !== input.userId ||
    stored.requestSha256 !== requestSha256(input)
  ) {
    throw new OrganizationProvisioningError(
      "Stored organization provisioning attempt is inconsistent",
      409,
    );
  }
  // Only irreversible purge certifies that these exact artifacts can never
  // be adopted. A disabled roster or scheduled deletion can be reversed.
  if (stored.billingStatus === "purged") {
    throw new OrganizationProvisioningError(
      "Organization creation was committed but the organization was purged",
      410,
    );
  }
  if (
    !isCreateOrganizationResponse(stored.response) ||
    stored.response.organizationId !== input.organizationId ||
    stored.response.rootContainerId !== input.rootContainerId ||
    stored.response.userId !== input.userId
  ) {
    throw new OrganizationProvisioningError(
      "Stored organization provisioning attempt is inconsistent",
      409,
    );
  }
  if (
    stored.rosterStatus !== "active" ||
    stored.billingStatus === null ||
    stored.billingStatus === "deleting"
  ) {
    throw new OrganizationProvisioningError(
      "Organization is no longer available for provisioning replay",
      409,
    );
  }
  return stored.response;
}

export async function recordOrganizationCreationReplay(
  tx: DatabaseTransaction,
  input: CreateOrganizationRequest,
  response: CreateOrganizationResponse,
): Promise<void> {
  if (!isOrdinaryCreate(input)) return;
  const [stored] = await tx
    .update(organizations)
    .set({
      provisioningUserId: input.userId,
      provisioningRequestSha256: requestSha256(input),
      provisioningResponse: response,
    })
    .where(eq(organizations.id, input.organizationId))
    .returning({ id: organizations.id });
  if (!stored) {
    throw new OrganizationProvisioningError(
      "Unable to persist organization provisioning response",
      500,
    );
  }
}
