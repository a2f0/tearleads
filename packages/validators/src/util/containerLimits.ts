/** Maximum number of containers in a root-to-leaf path, including both ends. */
export const MAX_CONTAINER_PATH_LENGTH = 100;

/**
 * Maximum number of stored manifests one container mutation may cite as the
 * mutated container's history. Inline bundles (8-14 KiB each) fit about this
 * many under the 32 MiB request ceiling; a reference is ~150 bytes, so the
 * bound keeps that capacity instead of letting a small body cite ~50x more.
 */
export const MAX_CONTAINER_MANIFEST_HISTORY_REFS = 4096;
