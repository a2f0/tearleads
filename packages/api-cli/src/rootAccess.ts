import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { rootAuditEvents, users } from "@tearleads/api-shared/schema";
import { and, eq, ne } from "drizzle-orm";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

interface RootAccessArgs {
  readonly fingerprint: string;
}

interface RootAccessResult {
  readonly changed: boolean;
  readonly userId: string;
}

export function parseRootAccessArgs(args: readonly string[]): RootAccessArgs {
  const [fingerprint, ...rest] = args;
  if (fingerprint === undefined) {
    throw new Error("A signing key fingerprint is required");
  }
  if (rest.length > 0) {
    throw new Error(`Unknown argument: ${rest[0]}`);
  }
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error(
      "Fingerprint must be the 64-character lowercase hex signing key fingerprint",
    );
  }

  return { fingerprint };
}

/**
 * Sets `users.is_root` for the identity registered with `fingerprint`. The
 * flag admits the identity to the API's `/root` operator routes. A change is
 * recorded in the root audit trail, with no actor, in the same transaction.
 * The flag is flipped only where it still differs, so concurrent runs record
 * exactly the one change that took effect.
 */
export async function setIdentityRootAccess(
  executor: ApiDatabase,
  input: { readonly fingerprint: string; readonly isRoot: boolean },
): Promise<RootAccessResult> {
  return executor.transaction(async (tx) => {
    const [changed] = await tx
      .update(users)
      .set({ isRoot: input.isRoot })
      .where(
        and(
          eq(users.fingerprint, input.fingerprint),
          ne(users.isRoot, input.isRoot),
        ),
      )
      .returning({ id: users.id });
    if (changed) {
      await tx.insert(rootAuditEvents).values({
        action: input.isRoot ? "root.access.grant" : "root.access.revoke",
        actorUserId: null,
        targetUserId: changed.id,
      });
      return { changed: true, userId: changed.id };
    }

    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.fingerprint, input.fingerprint))
      .limit(1);
    if (!user) {
      throw new Error(
        `No identity is registered with fingerprint ${input.fingerprint}`,
      );
    }
    return { changed: false, userId: user.id };
  });
}

export function formatRootAccessOutcome(
  fingerprint: string,
  isRoot: boolean,
  result: RootAccessResult,
): string {
  const state = isRoot ? "root" : "not root";
  return result.changed
    ? `Identity ${result.userId} (${fingerprint}) is now ${state}.`
    : `Identity ${result.userId} (${fingerprint}) was already ${state}.`;
}
