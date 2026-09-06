import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

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
 * flag admits the identity to the API's `/root` operator routes.
 */
export async function setIdentityRootAccess(
  executor: DatabaseSession,
  input: { readonly fingerprint: string; readonly isRoot: boolean },
): Promise<RootAccessResult> {
  const [user] = await executor
    .select({ id: users.id, isRoot: users.isRoot })
    .from(users)
    .where(eq(users.fingerprint, input.fingerprint))
    .limit(1);
  if (!user) {
    throw new Error(
      `No identity is registered with fingerprint ${input.fingerprint}`,
    );
  }
  if (user.isRoot === input.isRoot) {
    return { changed: false, userId: user.id };
  }

  await executor
    .update(users)
    .set({ isRoot: input.isRoot })
    .where(eq(users.id, user.id));

  return { changed: true, userId: user.id };
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
