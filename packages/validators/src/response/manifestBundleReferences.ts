import type { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import { nonEmptyStringSchema, plainRecordSchema } from "../schema";
import { AccessManifestBundleWireResponseSchema } from "../util";

/**
 * A writer projection names each access manifest by hash. The bundle for a
 * hash travels once, in `bundles`, however many lists cite it.
 */
export const ManifestHashReferenceSchema = nonEmptyStringSchema;

export const ManifestBundlesSchema = plainRecordSchema(
  AccessManifestBundleWireResponseSchema,
);

function listed(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Hashes cited by one container keying path: its path and every KEK history. */
export function containerKeyingPathReferences(path: unknown): unknown[] {
  if (!isPlainObject(path)) {
    return [];
  }
  const { containerKeks, path: manifests } = path;
  return [
    ...listed(manifests),
    ...listed(containerKeks).flatMap((kek) => {
      if (!isPlainObject(kek)) {
        return [];
      }
      const { containerManifestHistory } = kek;
      return listed(containerManifestHistory);
    }),
  ];
}

/**
 * Fails closed on the first inconsistency: a cited hash without a bundle, a
 * bundle stored under a key other than its own manifestHash, or a bundle no
 * list cites. Refinements may run after field errors, so inputs are unknown.
 */
export function refineManifestBundleReferences(
  bundles: unknown,
  references: readonly unknown[],
  context: z.RefinementCtx,
): void {
  if (!isPlainObject(bundles)) {
    return;
  }
  const cited = new Set(
    references.filter((hash): hash is string => typeof hash === "string"),
  );
  const issue = (message: string) =>
    context.addIssue({ code: "custom", message, path: ["bundles"] });
  for (const hash of cited) {
    if (!Object.hasOwn(bundles, hash)) {
      issue(`manifest ${hash} is cited without a bundle`);
      return;
    }
  }
  for (const [hash, bundle] of Object.entries(bundles)) {
    if (
      !isPlainObject(bundle) ||
      Reflect.get(bundle, "manifestHash") !== hash
    ) {
      issue(`bundle key ${hash} does not match its manifestHash`);
      return;
    }
    if (!cited.has(hash)) {
      issue(`bundle ${hash} is not cited`);
      return;
    }
  }
}
