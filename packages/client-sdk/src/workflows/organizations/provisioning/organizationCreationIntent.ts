import type { RequestResult } from "@tearleads/api-client";
import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "../../../data/sqlite/sqlSchema";
import type { OrganizationProvisioningArtifactsInput } from "../../registration/organizationProvisioning";
import { transitionOrganizationCreation } from "./organizationCreationState";
import { removeOrganizationProvisioningAttempt } from "./organizationProvisioningAttempt";

export interface CreateOrganizationApi {
  /** Typed refusals allow certified terminal attempts to be released. */
  createOrganizationResult?(
    request: CreateOrganizationRequest,
  ): Promise<RequestResult<CreateOrganizationResponse>>;
  createOrganization(
    request: CreateOrganizationRequest,
  ): Promise<CreateOrganizationResponse | null>;
}

interface OrganizationCreationScope {
  nativeSubscriptionRestore?: boolean | undefined;
  replacesOrganizationId?: string | undefined;
  userId: string;
}

/** Only unresolved, same-user operations coalesce; completion releases the intent. */
export function organizationCreationIntent(
  input: Omit<OrganizationProvisioningArtifactsInput, "rootContainerId"> &
    OrganizationCreationScope,
): string | undefined {
  if (input.replacesOrganizationId || input.nativeSubscriptionRestore) return;
  return serializeKeyingCanonicalJson(
    readKeyingCanonicalJson(
      {
        userId: input.userId,
        signingPublicKey: bytesToBase64(input.signingKeyPair.signingPublicKey),
        encapsulationPublicKey: bytesToBase64(
          input.encapsulationKeyPair.publicKey,
        ),
        organizationProfileName: input.organizationProfileName ?? null,
        rosterProfileNickname: input.rosterProfileNickname ?? null,
        provisionedSystemContainers: input.provisionedSystemContainers ?? [],
      },
      "organization creation intent",
    ),
  );
}

/** Request once: terminal refusal releases only this attempt, never retries now. */
export async function requestOrganizationCreation(
  input: {
    apiClient: CreateOrganizationApi;
    dbClient: ExecSqlClientLike;
    isIdentityCurrent?: (() => boolean) | undefined;
  },
  request: CreateOrganizationRequest,
) {
  // Response-only adapters cannot certify terminal refusal; fail closed on null.
  const response = input.apiClient.createOrganizationResult
    ? null
    : await input.apiClient.createOrganization(request);
  const result = input.apiClient.createOrganizationResult
    ? await input.apiClient.createOrganizationResult(request)
    : response
      ? { ok: true as const, data: response }
      : null;
  const state = transitionOrganizationCreation(
    { status: "pending", request },
    { type: "result", request, result },
  );
  if (state.status === "refused") {
    if (input.isIdentityCurrent && !input.isIdentityCurrent()) return null;
    await removeOrganizationProvisioningAttempt({
      canCommit: input.isIdentityCurrent,
      execSql: createExecSql(input.dbClient),
      organizationId: request.organizationId,
      replacedOrganizationId: request.organizationId,
      userId: request.userId,
    });
  }
  return state.status === "received" ? state.response : null;
}

/** Release ordinary intents in the bootstrap commit; recovery owns other modes. */
export function organizationCreationCompletion(
  input: OrganizationCreationScope,
  organizationId: string,
): ((execSql: ExecSql) => Promise<void>) | undefined {
  if (input.replacesOrganizationId || input.nativeSubscriptionRestore) return;
  return async (execSql) => {
    await removeOrganizationProvisioningAttempt({
      execSql,
      replacedOrganizationId: organizationId,
      organizationId,
      userId: input.userId,
    });
  };
}
