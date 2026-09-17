import {
  computeContainerKekMaterialId,
  type GroupMetadataKey,
} from "@tearleads/crypto";
import type { ContainerKekLogEpochResponse } from "@tearleads/validators/response";
import { fetchContainerKekLog } from "../../data/documents/shared/containerKekLogFetch";
import { rebuildKeyringEntriesFromLog } from "../../data/documents/shared/keyringLogWalk";
import { normalizeContainerKeyWrap } from "../../data/documents/shared/readers";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../data/principals/principalPolicyCrypto";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface Input {
  readonly apiClient: Parameters<typeof fetchContainerKekLog>[0]["apiClient"];
  readonly execSql: ExecSql;
  readonly metadata: Omit<GroupMetadataKey, "keyMaterial">;
  readonly targetSecretKey: Uint8Array;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmKeys: () => Promise<void>;
}

async function openEpoch(input: Input, epoch: ContainerKekLogEpochResponse) {
  for (const record of epoch.wraps) {
    const wrap = normalizeContainerKeyWrap(record);
    if (
      wrap.recipientKind === "container" ||
      wrap.containerKeyEpochId !== epoch.containerKeyEpochId
    )
      continue;
    try {
      const keyMaterial = await unwrapKeyEnvelopesWithPrincipalPolicies({
        execSql: input.execSql,
        secretKey: input.targetSecretKey,
        envelopes: [
          {
            keyFingerprint: wrap.recipientKeyFingerprint,
            kemCipherText: wrap.kemCipherText,
            wrappedKey: wrap.wrappedKey,
          },
        ],
      });
      if (
        keyMaterial &&
        (await computeContainerKekMaterialId({
          containerId: input.metadata.containerId,
          keyEpoch: epoch.containerKeyEpoch,
          keyMaterial,
        })) === epoch.containerKeyEpochId
      )
        return keyMaterial;
    } catch {
      // Another addressed envelope may still open this exact committed key.
    }
  }
  throw new Error("Group metadata recovery key is unavailable");
}

/**
 * A signed group pins a material-committing KEK id. Recover only that key from
 * the bounded log when a live container path awaits an ancestor update. Every
 * recovered key is checked against its id; the signed ciphertext supplies the
 * final group/organization binding. No container checkpoint advances here.
 */
export async function recoverGroupMetadataReadKey(
  input: Input,
): Promise<Uint8Array> {
  assertProjectionVerificationCurrent(input.stillCurrent);
  await input.warmKeys();
  const log = await fetchContainerKekLog({
    apiClient: input.apiClient,
    containerId: input.metadata.containerId,
  });
  const current = log.epochs.at(-1);
  const requested = log.epochs.find(
    (epoch) => epoch.containerKeyEpochId === input.metadata.containerKeyEpochId,
  );
  if (!current || !requested)
    throw new Error("Group metadata epoch is absent from its key log");
  let recovered = await openEpoch(input, requested).catch(() => null);
  if (!recovered) {
    const currentKey = await openEpoch(input, current);
    recovered =
      (
        await rebuildKeyringEntriesFromLog({
          containerId: input.metadata.containerId,
          currentContainerKey: currentKey,
          currentContainerKeyEpochId: current.containerKeyEpochId,
          log,
        })
      ).entries.find(
        (entry) => entry.containerKeyEpochId === requested.containerKeyEpochId,
      )?.keyMaterial ?? null;
  }
  if (!recovered)
    throw new Error("Group metadata historical key is unavailable");
  assertProjectionVerificationCurrent(input.stillCurrent);
  return recovered;
}
