import type { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import {
  arraySchema,
  nonEmptyStringSchema,
  plainRecordSchema,
} from "../schema";
import { AccessManifestBundleWireResponseSchema } from "../util";

/**
 * A writer projection names each access manifest by hash. The bundle for a
 * hash travels once, in `bundles`, however many lists cite it, or not at all
 * when the request cited it as already held (`omittedBundles`).
 */
export const ManifestHashReferenceSchema = nonEmptyStringSchema;

export const ManifestBundlesSchema = plainRecordSchema(
  AccessManifestBundleWireResponseSchema,
);

export const OmittedManifestBundlesSchema = arraySchema(
  ManifestHashReferenceSchema,
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

function firstBundleInconsistency(
  bundles: Record<string, unknown>,
  omitted: readonly unknown[],
  cited: ReadonlySet<string>,
): string | null {
  const omittedHashes = new Set<unknown>(omitted);
  if (omittedHashes.size !== omitted.length) {
    return "omittedBundles repeats a manifest hash";
  }
  for (const hash of omitted) {
    if (typeof hash !== "string" || !cited.has(hash)) {
      return `omitted bundle ${String(hash)} is not cited`;
    }
    if (Object.hasOwn(bundles, hash)) {
      return `omitted bundle ${hash} is also served`;
    }
  }
  for (const hash of cited) {
    if (!Object.hasOwn(bundles, hash) && !omittedHashes.has(hash)) {
      return `manifest ${hash} is cited without a bundle`;
    }
  }
  for (const [hash, bundle] of Object.entries(bundles)) {
    if (
      !isPlainObject(bundle) ||
      Reflect.get(bundle, "manifestHash") !== hash
    ) {
      return `bundle key ${hash} does not match its manifestHash`;
    }
    if (!cited.has(hash)) {
      return `bundle ${hash} is not cited`;
    }
  }
  return null;
}

/**
 * Fails closed on the first inconsistency: a cited hash neither served nor
 * declared omitted, a bundle stored under a key other than its own
 * manifestHash, a served or omitted bundle no list cites, or a hash both
 * served and omitted. Whether an omission was requested is the client's
 * check. Refinements may run after field errors, so inputs are unknown.
 */
export function refineManifestBundleReferences(
  projection: { readonly bundles: unknown; readonly omittedBundles: unknown },
  references: readonly unknown[],
  context: z.RefinementCtx,
): void {
  const { bundles, omittedBundles } = projection;
  if (!isPlainObject(bundles) || !Array.isArray(omittedBundles)) {
    return;
  }
  const cited = new Set(
    references.filter((hash): hash is string => typeof hash === "string"),
  );
  const message = firstBundleInconsistency(bundles, omittedBundles, cited);
  if (message !== null) {
    context.addIssue({ code: "custom", message, path: ["bundles"] });
  }
}
