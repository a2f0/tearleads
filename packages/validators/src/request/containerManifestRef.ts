import type { z } from "zod";
import {
  arraySchema,
  boundedNonEmptyArraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  sha256HexStringSchema,
} from "../schema";
import {
  MAX_CONTAINER_MANIFEST_HISTORY_REFS,
  MAX_CONTAINER_PATH_LENGTH,
} from "../util/containerLimits";

/**
 * A reference to a container access manifest the server already stores, in lieu
 * of re-embedding the full signed manifest bundle. The server resolves the full
 * manifest from its own store by `manifestHash` and pins it to the container's
 * current head, so the reference carries the same authority as the full bundle
 * without the multi-KB signature. `containerId` is advisory: the server keys the
 * head lookup off the resolved bundle's own containerId and rejects a mismatch.
 */
export const ContainerManifestRefSchema = loosePlainObject({
  containerId: nonEmptyStringSchema,
  manifestHash: nonEmptyStringSchema,
});

export type ContainerManifestRef = z.infer<typeof ContainerManifestRefSchema>;

/** A root→leaf container path, cited by manifest reference. */
export const ContainerManifestPathSchema = boundedNonEmptyArraySchema(
  ContainerManifestRefSchema,
  MAX_CONTAINER_PATH_LENGTH,
);

/**
 * A path that may be empty: a root container create cites no parent. Bounded
 * by the same depth ceiling as a non-empty path.
 */
export const OptionalContainerManifestPathSchema = arraySchema(
  ContainerManifestRefSchema,
  MAX_CONTAINER_PATH_LENGTH,
);

/**
 * Stored manifests of one container, cited by reference. A container's lineage
 * has no fixed length; the ceiling keeps the capacity inline bundles had under
 * the request-body bound (see `MAX_CONTAINER_MANIFEST_HISTORY_REFS`).
 */
export const ContainerManifestRefListSchema = arraySchema(
  ContainerManifestRefSchema,
  MAX_CONTAINER_MANIFEST_HISTORY_REFS,
);

/**
 * The parent KEK state a child container mutation wraps under, cited instead of
 * carried. The server loads the parent's current key epoch from its own store
 * and refuses a mismatch as `mutationStateStale`; the child's key epoch and its
 * parent wrap bind the same epoch id and hash.
 */
export const ContainerKekParentRefSchema = loosePlainObject({
  containerId: nonEmptyStringSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  keyEpochHash: sha256HexStringSchema,
});

export type ContainerKekParentRef = z.infer<typeof ContainerKekParentRefSchema>;
