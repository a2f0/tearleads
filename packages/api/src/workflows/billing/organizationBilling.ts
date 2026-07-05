import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import {
  createTrialBillingFields,
  LAPSED_BILLING_PURGE_GRACE_MS,
  type OrganizationBilling,
  organizationCanSync,
} from "../../billing/organizationBilling";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

const BILLING_ROW_COLUMNS = {
  organizationId: organizationBilling.organizationId,
  status: organizationBilling.status,
  trialEndsAt: organizationBilling.trialEndsAt,
  provider: organizationBilling.provider,
  currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
  disabledAt: organizationBilling.disabledAt,
  purgeAfter: organizationBilling.purgeAfter,
};

async function loadOrganizationBilling(
  executor: DatabaseSession,
  organizationId: string,
): Promise<OrganizationBilling> {
  const [row] = await executor
    .select(BILLING_ROW_COLUMNS)
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
    .limit(1);

  if (!row) {
    throw new OrganizationManagerError("Organization billing not found", 404);
  }

  return row;
}

/**
 * Loads an organization's billing, lazily expiring a lapsed trial. When a
 * `trialing` organization's `trialEndsAt` has passed, it flips to `disabled`
 * (recording `disabledAt` and a `purgeAfter` grace deadline) so sync stops. The
 * flip is guarded on the still-`trialing` status so concurrent callers converge.
 */
async function resolveOrganizationBilling(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<OrganizationBilling> {
  const billing = await loadOrganizationBilling(executor, organizationId);
  if (
    billing.status !== "trialing" ||
    billing.trialEndsAt === null ||
    billing.trialEndsAt > now
  ) {
    return billing;
  }

  const disabledAt = billing.trialEndsAt;
  const purgeAfter = new Date(
    disabledAt.getTime() + LAPSED_BILLING_PURGE_GRACE_MS,
  );

  // The lazy flip is a persistence optimization, not a correctness requirement:
  // `organizationCanSync` already treats an expired trial as non-syncable in
  // memory. Reads can reach this on a read-only executor (e.g. a read replica),
  // where the write would throw — so fall back to the virtual expired state
  // instead of failing the read. The expiry is definitive (`trialEndsAt <= now`),
  // so returning `disabled` is always the correct answer regardless of why the
  // write did not land.
  try {
    const [updated] = await executor
      .update(organizationBilling)
      .set({ status: "disabled", disabledAt, purgeAfter, updatedAt: now })
      .where(
        and(
          eq(organizationBilling.organizationId, organizationId),
          eq(organizationBilling.status, "trialing"),
        ),
      )
      .returning(BILLING_ROW_COLUMNS);

    if (!updated) {
      return loadOrganizationBilling(executor, organizationId);
    }

    return updated;
  } catch {
    return { ...billing, status: "disabled", disabledAt, purgeAfter };
  }
}

/**
 * Resolves billing and reports whether the organization may currently sync.
 * Sync choke points (mutations, list/pull filters) use this to gate one
 * organization's server sync.
 */
async function resolveOrganizationSyncEligibility(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<{ billing: OrganizationBilling; canSync: boolean }> {
  const billing = await resolveOrganizationBilling(
    executor,
    organizationId,
    now,
  );
  return { billing, canSync: organizationCanSync(billing, now) };
}

/**
 * Thrown when a sync operation targets an organization that cannot sync (its
 * billing is `local`/lapsed). Maps to HTTP 402 so the client can route to an
 * upgrade/enable-sync flow. Caught centrally by the route app error handler.
 */
export class OrganizationSyncDisabledError extends Error {
  readonly status = 402 as const;

  constructor(readonly organizationId: string) {
    super("Organization sync is not active");
    this.name = "OrganizationSyncDisabledError";
  }
}

/**
 * Guards a sync write against the target organization's billing. Call at the
 * public sync workflow boundary once the authoritative `organizationId` is
 * known (registration's own bootstrap calls the lower-level handlers directly,
 * so it is intentionally not gated here). Throws {@link
 * OrganizationSyncDisabledError} (402) when the organization cannot sync.
 */
export async function assertOrganizationCanSync(
  executor: DatabaseSession,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  const { canSync } = await resolveOrganizationSyncEligibility(
    executor,
    organizationId,
    now,
  );
  if (!canSync) {
    throw new OrganizationSyncDisabledError(organizationId);
  }
}

/**
 * Starts an organization's free sync trial. Admin-only. A `local` organization
 * transitions to `trialing`; an already `trialing`/`active` organization is
 * returned unchanged (idempotent); a lapsed organization (`past_due`,
 * `disabled`, `deleting`, `purged`) cannot re-trial and must subscribe.
 */
async function startOrganizationTrialInTransaction(input: {
  executor: DatabaseSession;
  now: Date;
  organizationId: string;
  sessionUserId: string;
}): Promise<OrganizationBilling> {
  await requireDirectOrganizationAccess({
    executor: input.executor,
    organizationId: input.organizationId,
    requireAdmin: true,
    userId: input.sessionUserId,
  });

  const billing = await resolveOrganizationBilling(
    input.executor,
    input.organizationId,
    input.now,
  );
  if (billing.status === "trialing" || billing.status === "active") {
    return billing;
  }
  if (billing.status !== "local") {
    throw new OrganizationManagerError(
      "Organization trial is no longer available",
      409,
    );
  }

  const { status, trialEndsAt } = createTrialBillingFields(input.now);
  const [updated] = await input.executor
    .update(organizationBilling)
    .set({ status, trialEndsAt, updatedAt: input.now })
    .where(
      and(
        eq(organizationBilling.organizationId, input.organizationId),
        eq(organizationBilling.status, "local"),
      ),
    )
    .returning(BILLING_ROW_COLUMNS);

  if (!updated) {
    return loadOrganizationBilling(input.executor, input.organizationId);
  }

  return updated;
}

export async function runGetOrganizationBillingWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  now: Date = new Date(),
): Promise<OrganizationBilling> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      userId: sessionUserId,
    });
    return resolveOrganizationBilling(tx, organizationId, now);
  });
}

export async function runStartOrganizationTrialWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
  now: Date = new Date(),
): Promise<OrganizationBilling> {
  return db.transaction((tx) =>
    startOrganizationTrialInTransaction({
      executor: tx,
      now,
      organizationId,
      sessionUserId,
    }),
  );
}
