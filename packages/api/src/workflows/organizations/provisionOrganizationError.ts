export class OrganizationProvisioningError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 410 | 500 | 503,
  ) {
    super(message);
  }
}
