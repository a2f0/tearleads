import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  sameOrganizationIds,
  twoFactorRequiredOrganizationIdsSql,
  type UserStanding,
} from "../../middleware/userActivity";
import type { ApiServiceRuntime } from "../runtime";

/** The standing read when the session's activity stamp did not return it. */
async function readUserStanding(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<UserStanding> {
  const [row] = await runtime.db
    .select({
      suspendedAt: users.suspendedAt,
      twoFactorRequiredOrganizationIds: twoFactorRequiredOrganizationIdsSql,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    suspended: Boolean(row?.suspendedAt),
    twoFactorRequiredOrganizationIds:
      row?.twoFactorRequiredOrganizationIds ?? [],
  };
}

export type LoginSession =
  | {
      readonly status: "open";
      readonly sessionId: string;
      readonly token: string;
    }
  | { readonly status: "suspended" };

/**
 * Stores a signed-in session, then checks it against the standing read after
 * it was stored. A suspension or a two-factor requirement change sweeps the
 * user's sessions after it commits, so one that committed since sign-in read
 * the user row may have swept before this session existed; reading again now
 * leaves no window between them. A changed requirement reissues the session
 * once with the new set; requireAuth's activity check covers later changes.
 */
export async function openLoginSession(
  runtime: ApiServiceRuntime,
  input: {
    readonly fingerprint: string;
    readonly ipAddress?: string | null | undefined;
    /** Read with the user row; ignored once a second factor passed. */
    readonly twoFactorRequiredOrganizationIds: readonly string[];
    readonly twoFactorVerified: boolean;
    readonly userId: string;
  },
): Promise<LoginSession> {
  const open = (twoFactorRequiredOrganizationIds: readonly string[]) =>
    runtime.sessionTokenIssuer.createSession({
      createdAt: Date.now(),
      fingerprint: input.fingerprint,
      ipAddress: input.ipAddress,
      twoFactorRequiredOrganizationIds,
      twoFactorVerified: input.twoFactorVerified,
      userId: input.userId,
    });
  const revoke = (sessionId: string) =>
    runtime.sessionTokenIssuer.revokeSession({
      sessionId,
      userId: input.userId,
    });

  const required = input.twoFactorVerified
    ? []
    : input.twoFactorRequiredOrganizationIds;
  let issued = await open(required);
  let standing =
    issued.standing ?? (await readUserStanding(runtime, input.userId));
  if (
    !input.twoFactorVerified &&
    !standing.suspended &&
    !sameOrganizationIds(standing.twoFactorRequiredOrganizationIds, required)
  ) {
    await revoke(issued.sessionId);
    issued = await open(standing.twoFactorRequiredOrganizationIds);
    standing = issued.standing ?? standing;
  }
  if (standing.suspended) {
    await revoke(issued.sessionId);
    return { status: "suspended" };
  }
  return { sessionId: issued.sessionId, status: "open", token: issued.token };
}
