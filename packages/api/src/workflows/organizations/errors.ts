type OrganizationManagerErrorStatus = 400 | 403 | 404 | 409;

export class OrganizationManagerError extends Error {
  constructor(
    message: string,
    readonly status: OrganizationManagerErrorStatus,
    readonly code?: string,
  ) {
    super(message);
  }
}
