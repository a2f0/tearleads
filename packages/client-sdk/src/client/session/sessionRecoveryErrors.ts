import type { OrganizationBillingStatus } from "@tearleads/validators/response";

/** Recovery provisioned a replacement that must be activated before rebind. */
export class PurgedOrganizationRecoveryBillingRequiredError extends Error {
  readonly code = "purged_organization_recovery_billing_required" as const;

  constructor(
    readonly replacementOrganizationId: string,
    readonly billingStatus: OrganizationBillingStatus,
    readonly replacementContainerId: string,
  ) {
    super(
      `Organization ${replacementOrganizationId} requires active sync billing before purge recovery can finish`,
    );
    this.name = "PurgedOrganizationRecoveryBillingRequiredError";
  }
}
