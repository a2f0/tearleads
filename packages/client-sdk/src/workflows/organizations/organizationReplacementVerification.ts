import {
  KeyingVerificationError,
  type VerifiedOrganizationReplacementAuthorization,
  verifyOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import type { CreateOrganizationResponse } from "@tearleads/validators/response";
import { persistOrganizationReplacementCheckpoints } from "../../data/persistence/organizationReplacementCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

/** The API's user/organization echoes are not authority to rehome local data. */
export function verifyOrganizationReplacementResponse(input: {
  readonly replacesOrganizationId: string;
  readonly response: CreateOrganizationResponse;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}): VerifiedOrganizationReplacementAuthorization {
  const { response } = input;
  const authorization = verifyOrganizationReplacementAuthorization(
    response.replacementAuthorization,
    input.signingPublicKey,
  );
  if (
    authorization.replacesOrganizationId !== input.replacesOrganizationId ||
    authorization.userId !== input.userId ||
    response.userId !== input.userId ||
    authorization.organizationId !== response.organizationId ||
    authorization.rootContainerId !== response.rootContainerId ||
    authorization.rootManifestHash !== response.rootMetadataAccessStateHash ||
    authorization.rootMetadataDocumentId !== response.rootMetadataDocumentId ||
    response.rootMetadataAccessEpoch !== 1
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Organization replacement response does not match its signed authorization",
    );
  }
  return authorization;
}

export async function pinOrganizationReplacementResponse(
  input: Parameters<typeof verifyOrganizationReplacementResponse>[0] & {
    readonly execSql: ExecSql;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
): Promise<boolean> {
  return persistOrganizationReplacementCheckpoints({
    authorization: verifyOrganizationReplacementResponse(input),
    execSql: input.execSql,
    stillCurrent: input.stillCurrent,
  });
}
