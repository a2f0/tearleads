import { mergeVersionVectors, satisfiesVersionVector } from "@tearleads/loro";

interface DocumentVersionSpan {
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/**
 * Extend a trusted coverage frontier through durable or remotely accepted
 * update spans. A span is usable only when its start is already covered and
 * its end belongs to the current document. Iterating to a fixed point lets a
 * persisted queue restore coverage even when its rows are not topologically
 * ordered.
 *
 * Invalid or disconnected spans are ignored. The caller can then materialize
 * the remaining frontier instead of classifying unproven operations as safe.
 */
export function extendDocumentVersionCoverage(input: {
  readonly baseVersion: string;
  readonly documentVersion: string;
  readonly spans: readonly DocumentVersionSpan[];
}): string {
  let coverage = mergeVersionVectors([input.baseVersion]);
  if (!satisfiesVersionVector(input.documentVersion, coverage)) {
    throw new Error("Document coverage base is outside the current snapshot");
  }
  const remaining = new Set(input.spans.keys());

  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const index of remaining) {
      const span = input.spans[index];
      if (!span) continue;

      try {
        const isConnected = satisfiesVersionVector(
          coverage,
          span.partialStartVersionVector,
        );
        const isWellFormed = satisfiesVersionVector(
          span.partialEndVersionVector,
          span.partialStartVersionVector,
        );
        const belongsToDocument = satisfiesVersionVector(
          input.documentVersion,
          span.partialEndVersionVector,
        );
        if (!isConnected || !isWellFormed || !belongsToDocument) continue;

        coverage = mergeVersionVectors([
          coverage,
          span.partialEndVersionVector,
        ]);
        remaining.delete(index);
        advanced = true;
      } catch {
        remaining.delete(index);
      }
    }
  }

  return coverage;
}
