import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  type RootIdentitySummary,
  rootIdentitySelection,
  toRootIdentitySummary,
} from "./identitySummary";

export async function getRootIdentity(
  executor: DatabaseSession,
  userId: string,
): Promise<RootIdentitySummary | null> {
  const [row] = await executor
    .select(rootIdentitySelection)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ? toRootIdentitySummary(row) : null;
}

export async function isRootIdentity(
  executor: DatabaseSession,
  userId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ isRoot: users.isRoot })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.isRoot === true;
}
