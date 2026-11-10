import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { OrganizationProvisioningArtifactsInput } from "../../registration/organizationProvisioning";
import { removeOrganizationProvisioningAttempt } from "./organizationProvisioningAttempt";

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
