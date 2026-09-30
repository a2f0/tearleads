import { KeyingVerificationError } from "@tearleads/crypto";

/**
 * The organization metadata root was read before a reserved-group commit that
 * the signed directory already reflects: each head it cites that differs from
 * the directory is a verified predecessor of the directory's head. That is an
 * honest read race, so readers reload the root rather than report tampering
 * (#2365 finding 22).
 */
export class MetadataRootBehindDirectoryError extends Error {
  constructor() {
    super("Organization metadata root cites a superseded reserved-group head");
    this.name = "MetadataRootBehindDirectoryError";
  }
}

/**
 * Runs `load`, then once more after `evictRoot` if the root it read was
 * behind. Honest servers re-cite the reserved groups in the commit that
 * advances them, so a root still behind after a fresh read is an incident.
 */
export async function withMetadataRootReload<Result>(
  load: () => Promise<Result>,
  evictRoot: () => void,
): Promise<Result> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof MetadataRootBehindDirectoryError)) throw error;
  }
  evictRoot();
  try {
    return await load();
  } catch (error) {
    if (error instanceof MetadataRootBehindDirectoryError) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Organization metadata root is still behind the signed directory after a reload",
      );
    }
    throw error;
  }
}
