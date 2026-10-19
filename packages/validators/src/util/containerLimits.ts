/** Maximum number of containers in a root-to-leaf path, including both ends. */
export const MAX_CONTAINER_PATH_LENGTH = 100;

/**
 * Maximum number of stored manifests one container mutation may cite as the
 * mutated container's history. Inline bundles (8-14 KiB each) fit about this
 * many under the 32 MiB request ceiling; a reference is ~150 bytes, so the
 * bound keeps that capacity instead of letting a small body cite ~50x more.
 */
export const MAX_CONTAINER_MANIFEST_HISTORY_REFS = 4096;

/**
 * Maximum number of principal policy heads one container mutation may cite.
 * Each citation makes the server verify that principal's stored policy, so
 * the bound keeps the capacity inline signed policies (about 9.8 KiB each)
 * had under the 32 MiB request ceiling instead of letting a ~170-byte reference
 * multiply that work.
 */
export const MAX_CONTAINER_PRINCIPAL_POLICY_REFS = 4096;
