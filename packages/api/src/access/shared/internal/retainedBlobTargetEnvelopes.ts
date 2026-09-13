import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { blobContentKeyTargets } from "@tearleads/api-shared/schema";
import { and, eq, or } from "drizzle-orm";
import {
  BlobContentKeyBundleError,
  type BlobContentKeyTargetEnvelope,
  targetEnvelopeMaterialEqual,
  targetKey,
  targetKeyMaterialEqual,
} from "./blobContentKeyTargets";

const materialKey = (target: BlobContentKeyTargetEnvelope) =>
  `${targetKey(target)}:${target.containerKeyEpochId}`;

/** Re-entering a retired target reuses its immutable, previously stored wrap. */
export async function resolveRetainedBlobTargetEnvelopes(input: {
  currentTargets: readonly BlobContentKeyTargetEnvelope[];
  epochId: string;
  executor: DatabaseSession;
  targets: readonly BlobContentKeyTargetEnvelope[];
}): Promise<readonly BlobContentKeyTargetEnvelope[]> {
  if (input.targets.length === 0) return [];
  const retained = await input.executor
    .select()
    .from(blobContentKeyTargets)
    .where(
      and(
        eq(blobContentKeyTargets.blobContentKeyEpochId, input.epochId),
        or(
          ...input.targets.map((target) =>
            and(
              eq(blobContentKeyTargets.bindingId, target.bindingId),
              eq(blobContentKeyTargets.documentId, target.documentId),
              eq(blobContentKeyTargets.containerId, target.containerId),
              eq(
                blobContentKeyTargets.containerKeyEpochId,
                target.containerKeyEpochId,
              ),
            ),
          ),
        ),
      ),
    );
  const priorByKey = new Map(
    retained.map((target) => [materialKey(target), target]),
  );
  const currentByKey = new Map(
    input.currentTargets.map((target) => [materialKey(target), target]),
  );
  return input.targets.map((target) => {
    const prior = priorByKey.get(materialKey(target));
    if (
      !prior ||
      !targetKeyMaterialEqual(prior, target) ||
      targetEnvelopeMaterialEqual(prior, target)
    )
      return target;
    // Active key material cannot be replaced. A removed target, however, is
    // absent from the client's latest bundle; randomized encryption naturally
    // produces a new IV when it returns. Keep the authentic retained envelope.
    if (currentByKey.has(materialKey(target)))
      throw new BlobContentKeyBundleError(
        "Blob content-key bundle conflict",
        409,
      );
    return {
      ...target,
      wrappedKey: prior.wrappedKey,
      wrappingMetadata: prior.wrappingMetadata,
    };
  });
}
