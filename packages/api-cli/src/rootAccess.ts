import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { rootAuditEvents, users } from "@tearleads/api-shared/schema";
import {
  computeUserIdentityBundleFingerprint,
  decodeIdentityLink,
  type IdentityLinkExpectation,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, eq, ne } from "drizzle-orm";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

/** Who to change: a signing key fingerprint, or an identity link to verify. */
type RootAccessTarget =
  | { readonly kind: "fingerprint"; readonly fingerprint: string }
  | { readonly kind: "identity-link"; readonly link: IdentityLinkExpectation };

interface RootAccessResult {
  readonly changed: boolean;
  readonly userId: string;
}

export function parseRootAccessArgs(args: readonly string[]): RootAccessTarget {
  const [identity, ...rest] = args;
  if (identity === undefined) {
    throw new Error("A signing key fingerprint or identity link is required");
  }
  if (rest.length > 0) {
    throw new Error(`Unknown argument: ${rest[0]}`);
  }
  if (FINGERPRINT_PATTERN.test(identity)) {
    return { kind: "fingerprint", fingerprint: identity };
  }
  const link = decodeIdentityLink(identity);
  if (link) {
    return { kind: "identity-link", link };
  }
  throw new Error(
    "Expected the 64-character lowercase hex signing key fingerprint or a complete identity link",
  );
}

/**
 * Returns the signing key fingerprint of the identity a link names, once the
 * link's commitment matches the keys registered for that user. A link whose
 * keys differ is refused rather than trusted for its user ID alone.
 */
export async function resolveIdentityLinkFingerprint(
  executor: ApiDatabase,
  link: IdentityLinkExpectation,
): Promise<string> {
  const [user] = await executor
    .select({
      encapsulationPublicKey: users.encapsulationPublicKey,
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, link.userId))
    .limit(1);
  if (!user) {
    throw new Error(`No identity is registered with user ID ${link.userId}`);
  }
  const committed = await computeUserIdentityBundleFingerprint({
    encapsulationPublicKey: base64ToBytes(user.encapsulationPublicKey),
    identityTrustDomain: link.identityTrustDomain,
    signingPublicKey: base64ToBytes(user.signingPublicKey),
    userId: link.userId,
  });
  if (committed !== link.fingerprint) {
    throw new Error(
      `The identity link does not match the keys registered for user ID ${link.userId}`,
    );
  }
  return user.fingerprint;
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
