import type { ProjectionHistoryPrefix } from "@tearleads/validators/util";
import { bytesToHex } from "./hex";
import { createIncrementalSha256 } from "./incrementalSha256";
import {
  type HistoryProjection,
  projectionHistoryArrays,
} from "./projectionHistorySlots";

export type { HistoryProjection } from "./projectionHistorySlots";
export interface RetainedProjectionHistory {
  readonly prefix: ProjectionHistoryPrefix;
  readonly arrayKey: string;
  readonly values: readonly unknown[];
}

function historyDigest(key: string, values: readonly unknown[]): string {
  const hash = createIncrementalSha256();
  hash.update(
    new TextEncoder().encode(
      JSON.stringify(["tearleads.projection-history", key, values]),
    ),
  );
  return bytesToHex(hash.digest());
}

/** Byte commitments describe evidence, not an authorization or verification result. */
export function captureProjectionHistory(
  projection: HistoryProjection,
): RetainedProjectionHistory[] {
  return projectionHistoryArrays(projection).flatMap((array) =>
    array.chains.flatMap((chain) => {
      if (chain.values.length === 0) return [];
      const values = structuredClone(chain.values);
      return [
        {
          arrayKey: array.key,
          values,
          prefix: {
            key: chain.key,
            count: values.length,
            digest: historyDigest(chain.key, values),
          },
        },
      ];
    }),
  );
}

/** Call only after normal server authorization and stored-evidence verification. */
export function omitProjectionHistory<T extends HistoryProjection>(
  projection: T,
  hints: readonly ProjectionHistoryPrefix[],
): T {
  if (hints.length === 0) return projection;
  const result = structuredClone(projection);
  const requested = new Map(hints.map((hint) => [hint.key, hint]));
  const omitted: ProjectionHistoryPrefix[] = [];
  for (const array of projectionHistoryArrays(result)) {
    const removed = new Set<unknown>();
    for (const chain of array.chains) {
      const hint = requested.get(chain.key);
      if (!hint || hint.count > chain.values.length) continue;
      const prefix = chain.values.slice(0, hint.count);
      if (historyDigest(chain.key, prefix) !== hint.digest) continue;
      for (const item of prefix) removed.add(item);
      omitted.push(hint);
    }
    const retained = array.values.filter((value) => !removed.has(value));
    array.values.length = 0;
    for (const value of retained) array.values.push(value);
  }
  if (omitted.length) result.historyPrefixes = omitted;
  return result;
}

/** Rebuild exact cached evidence before the caller performs all ordinary checks. */
export function restoreProjectionHistory(
  projection: HistoryProjection,
  requested: readonly RetainedProjectionHistory[],
): boolean {
  const arrays = new Map(
    projectionHistoryArrays(projection).map((array) => [
      array.key,
      array.values,
    ]),
  );
  const available = new Map(
    requested.map((entry) => [entry.prefix.key, entry]),
  );
  for (const prefix of projection.historyPrefixes ?? []) {
    const entry = available.get(prefix.key);
    if (
      !entry ||
      entry.prefix.count !== prefix.count ||
      entry.prefix.digest !== prefix.digest
    )
      return false;
    const target = arrays.get(entry.arrayKey);
    if (!target || historyDigest(prefix.key, entry.values) !== prefix.digest)
      return false;
    const suffix = target.slice();
    target.length = 0;
    for (const value of structuredClone(entry.values)) target.push(value);
    for (const value of suffix) target.push(value);
    available.delete(prefix.key);
  }
  delete projection.historyPrefixes;
  return true;
}
