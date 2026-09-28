import {
  organizationReplacementAuthorizationPayload,
  organizationReplacementSigningBytes,
  verifyOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

/** Applies before provisioning, winner replay, and replacement finalization. */
export async function validateOrganizationReplacementAuthorization(
  request: CreateOrganizationRequest,
  signingPublicKey: Uint8Array,
): Promise<void> {
  if (!request.replacesOrganizationId) {
    if (request.replacementAuthorization !== undefined) {
      throw new OrganizationProvisioningError(
        "Replacement authorization requires a replaced organization",
        400,
      );
    }
    return;
  }
  try {
    const authorization = verifyOrganizationReplacementAuthorization(
      request.replacementAuthorization,
      signingPublicKey,
    );
    const expected = await organizationReplacementAuthorizationPayload({
      ...request,
      replacesOrganizationId: request.replacesOrganizationId,
    });
    if (
      bytesToBase64(organizationReplacementSigningBytes(authorization)) !==
      bytesToBase64(organizationReplacementSigningBytes(expected))
    ) {
      throw new Error("Replacement authorization does not match provisioning");
    }
  } catch (error) {
    throw new OrganizationProvisioningError(
      error instanceof Error
        ? error.message
        : "Replacement authorization is invalid",
      400,
    );
  }
}
