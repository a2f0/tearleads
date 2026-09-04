import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
} from "@tearleads/api-shared/schema";
import { assertNamedGroupPolicies } from "./assertNamedGroupPolicies";

const RESET_REQUIRED_MESSAGE =
  "API database schema is not the current greenfield baseline; destroy and reprovision the database before deploying this release";
const POSTGRES_MISSING_SCHEMA_CODES = new Set(["42P01", "42703"]);
const SQLITE_MISSING_SCHEMA_PATTERN = /\bno such (?:table|column):/i;

function errorProperty(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null && key in error
    ? Reflect.get(error, key)
    : undefined;
}

export function isMissingCurrentApiSchemaError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current);
    const code = errorProperty(current, "code");
    if (typeof code === "string" && POSTGRES_MISSING_SCHEMA_CODES.has(code)) {
      return true;
    }
    const message = errorProperty(current, "message");
    if (
      typeof message === "string" &&
      SQLITE_MISSING_SCHEMA_PATTERN.test(message)
    ) {
      return true;
    }
    current = errorProperty(current, "cause");
  }
  return false;
}

/** Fail closed when a rewritten greenfield baseline was not provisioned. */
export async function assertCurrentApiSchema(
  executor: DatabaseSession,
): Promise<void> {
  try {
    await executor
      .select({
        trialExpiryAttemptCount: organizationBilling.trialExpiryAttemptCount,
        trialExpiryLastError: organizationBilling.trialExpiryLastError,
        trialExpiryNextAttemptAt: organizationBilling.trialExpiryNextAttemptAt,
      })
      .from(organizationBilling)
      .limit(0);
    await executor
      .select({ id: organizationBillingLifecycleEvents.id })
      .from(organizationBillingLifecycleEvents)
      .limit(0);
    await assertNamedGroupPolicies(executor);
  } catch (cause) {
    if (isMissingCurrentApiSchemaError(cause)) {
      throw new Error(RESET_REQUIRED_MESSAGE, { cause });
    }
    throw cause;
  }
}
