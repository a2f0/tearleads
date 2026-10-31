import { containers, users } from "@tearleads/api-shared/schema";
import {
  authChallengeSigningBytes,
  toFingerprint,
  verify,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, eq, isNull } from "drizzle-orm";
import type { ApiServiceRuntime } from "../runtime";

interface VerifyChallengeInput {
  /** The origin this API expects challenges to be signed for. */
  apiOrigin: string;
  fingerprint: string;
  ipAddress?: string | null | undefined;
  signature: number[];
}

interface VerifyChallengeResult {
  /** Platform-operator flag from `users.is_root`; gates the root console. */
  isRoot: boolean;
  organizationId: string;
  rootContainerId: string | null;
  /** The new session's id, which a websocket ticket for it binds to. */
  sessionId: string;
  token: string;
  userId: string;
}

type VerifyChallengeErrorReason =
  | "account_suspended"
  | "challenge_not_found"
  | "invalid_signature"
  | "unknown_fingerprint";

export class VerifyChallengeError extends Error {
  constructor(
    message: string,
    readonly reason: VerifyChallengeErrorReason,
  ) {
    super(message);
  }
}

function suspendedError(): VerifyChallengeError {
  return new VerifyChallengeError("Account suspended", "account_suspended");
}

async function isSuspended(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<boolean> {
  const [row] = await runtime.db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(row?.suspendedAt);
}

export async function verifyChallenge(
  runtime: ApiServiceRuntime,
  input: VerifyChallengeInput,
): Promise<VerifyChallengeResult> {
  const challengeHex = await runtime.keyValueStore.getdel(
    `challenge:${input.fingerprint}`,
  );
  if (!challengeHex) {
    throw new VerifyChallengeError(
      "Challenge expired or not found",
      "challenge_not_found",
    );
  }

  // The root container joins the user row: `containers_org_root_idx` is a
  // unique partial index, so the join yields at most one row.
  const [user] = await runtime.db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
      id: users.id,
      isRoot: users.isRoot,
      rootContainerId: containers.id,
      signingPublicKey: users.signingPublicKey,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .leftJoin(
      containers,
      and(
        eq(containers.organizationId, users.defaultOrganizationId),
        isNull(containers.parentId),
        isNull(containers.systemSlot),
      ),
    )
    .where(eq(users.fingerprint, input.fingerprint))
    .limit(1);

  if (!user) {
    throw new VerifyChallengeError(
      "Unknown fingerprint",
      "unknown_fingerprint",
    );
  }

  const publicKey = base64ToBytes(user.signingPublicKey);
  // Defense in depth: the query matches the fingerprint column, but auth should
  // fail closed if stored signing key material ever drifts from that binding.
  if ((await toFingerprint(publicKey)) !== input.fingerprint) {
    throw new VerifyChallengeError(
      "Unknown fingerprint",
      "unknown_fingerprint",
    );
  }

  const challengeBytes = authChallengeSigningBytes({
    apiOrigin: input.apiOrigin,
    challengeHex,
    fingerprint: input.fingerprint,
  });
  const signatureBytes = new Uint8Array(input.signature);

  if (!verify(signatureBytes, challengeBytes, publicKey)) {
    throw new VerifyChallengeError("Invalid signature", "invalid_signature");
  }
  // Checked only after the signature, so only the key holder learns of it.
  if (user.suspendedAt) {
    throw suspendedError();
  }

  const { sessionId, token } = await runtime.sessionTokenIssuer.createSession({
    userId: user.id,
    fingerprint: input.fingerprint,
    createdAt: Date.now(),
    ipAddress: input.ipAddress,
  });
  // A suspension committed since the read above may have swept the user's
  // sessions before this one existed. It commits the flag before sweeping, so
  // re-reading it after the session is stored leaves no window between them.
  if (await isSuspended(runtime, user.id)) {
    await runtime.sessionTokenIssuer.revokeSession({
      sessionId,
      userId: user.id,
    });
    throw suspendedError();
  }

  return {
    rootContainerId: user.rootContainerId,
    isRoot: user.isRoot,
    organizationId: user.defaultOrganizationId,
    sessionId,
    token,
    userId: user.id,
  };
}
