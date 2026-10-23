import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  type RootIdentitySummary,
  rootIdentitySelection,
  toRootIdentitySummary,
} from "./identitySummary";

type RootSuspensionResult =
  | { readonly identity: RootIdentitySummary; readonly kind: "suspended" }
  | { readonly kind: "missing" }
  | { readonly kind: "root" };

/**
 * Marks a non-root identity suspended. The root check rides in the update's
 * own predicate, so an identity granted root concurrently is never suspended.
 * An identity that is already suspended keeps its original timestamp.
 */
export async function suspendRootIdentity(
  executor: DatabaseSession,
  input: { readonly now: Date; readonly userId: string },
): Promise<RootSuspensionResult> {
  const [suspended] = await executor
    .update(users)
    .set({ suspendedAt: input.now })
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.isRoot, false),
        isNull(users.suspendedAt),
      ),
    )
    .returning(rootIdentitySelection);
  if (suspended) {
    return { identity: toRootIdentitySummary(suspended), kind: "suspended" };
  }

  const [row] = await executor
    .select(rootIdentitySelection)
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!row) {
    return { kind: "missing" };
  }
  return row.isRoot
    ? { kind: "root" }
    : { identity: toRootIdentitySummary(row), kind: "suspended" };
}

export async function liftRootIdentitySuspension(
  executor: DatabaseSession,
  userId: string,
): Promise<RootIdentitySummary | null> {
  const [row] = await executor
    .update(users)
    .set({ suspendedAt: null })
    .where(eq(users.id, userId))
    .returning(rootIdentitySelection);
  return row ? toRootIdentitySummary(row) : null;
}
