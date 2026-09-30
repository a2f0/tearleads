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
