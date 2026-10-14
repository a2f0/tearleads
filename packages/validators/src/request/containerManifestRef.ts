import type { z } from "zod";
import {
  arraySchema,
  boundedNonEmptyArraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
} from "../schema";
import { MAX_CONTAINER_PATH_LENGTH } from "../util/containerLimits";

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
 * has no fixed length, so this list keeps the request-body bound only.
 */
export const ContainerManifestRefListSchema = arraySchema(
  ContainerManifestRefSchema,
);
