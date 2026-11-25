import { containers, users, userTwoFactor } from "@tearleads/api-shared/schema";
import {
  authChallengeSigningBytes,
  toFingerprint,
  verify,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { TwoFactorLoginCode } from "@tearleads/validators/request";
import { and, eq, isNull } from "drizzle-orm";
import { twoFactorRequiredOrganizationIdsSql } from "../../middleware/userActivity";
import { resolveLoginSecondFactor } from "../../workflows/auth/twoFactor/loginSecondFactor";
import {
  type TwoFactorRecord,
  twoFactorRecordColumns,
} from "../../workflows/auth/twoFactor/store";
import type { ApiServiceRuntime } from "../runtime";
import { openLoginSession } from "./loginSession";

interface VerifyChallengeInput {
  /** The origin this API expects challenges to be signed for. */
  apiOrigin: string;
  fingerprint: string;
  ipAddress?: string | null | undefined;
  /** Canonical base64 of the ML-DSA-87 signature. */
  signature: string;
  /** A typed second factor, for an identity with two-factor turned on. */
  twoFactor?: TwoFactorLoginCode | undefined;
  /** A remembered device's token, standing in for a typed second factor. */
  twoFactorDeviceToken?: string | undefined;
}

interface VerifyChallengeResult {
  /** Platform-operator flag from `users.is_root`; gates the root console. */
  isRoot: boolean;
  organizationId: string;
  rootContainerId: string | null;
  /** The new session's id, which a websocket ticket for it binds to. */
  sessionId: string;
  token: string;
  /** Issued when a typed code asked to remember this device. */
  twoFactorDeviceToken: string | null;
  userId: string;
}

type VerifyChallengeErrorReason =
  | "account_suspended"
  | "challenge_not_found"
  | "invalid_signature"
  | "two_factor_invalid"
  | "two_factor_locked"
  | "two_factor_required"
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

const secondFactorRefusals = {
  invalid: ["Invalid two-factor code", "two_factor_invalid"],
  locked: [
    "Too many invalid two-factor codes; try again later",
    "two_factor_locked",
  ],
  required: ["Two-factor code required", "two_factor_required"],
} as const;

function joinedTwoFactorRecord(row: {
  readonly id: string;
  readonly twoFactorEnabledAt: Date | null;
  readonly twoFactorFailedAttempts: number | null;
  readonly twoFactorLastUsedStep: number | null;
  readonly twoFactorLockedUntil: Date | null;
  readonly twoFactorSecretCiphertext: string | null;
}): TwoFactorRecord | null {
  if (row.twoFactorSecretCiphertext === null) return null;
  return {
    enabledAt: row.twoFactorEnabledAt,
    failedAttempts: row.twoFactorFailedAttempts ?? 0,
    lastUsedStep: row.twoFactorLastUsedStep,
    lockedUntil: row.twoFactorLockedUntil,
    secretCiphertext: row.twoFactorSecretCiphertext,
    userId: row.id,
  };
}

async function requireSecondFactor(
  runtime: ApiServiceRuntime,
  input: VerifyChallengeInput,
  record: TwoFactorRecord | null,
) {
  const secondFactor = await resolveLoginSecondFactor({
    answer: input.twoFactor,
    deviceToken: input.twoFactorDeviceToken,
    deviceTrust: runtime.keyValueStore,
    executor: runtime.db,
    now: new Date(),
    record,
    serverSecret: runtime.documentSyncCursorHmacKey,
  });
  if (
    secondFactor.status === "verified" ||
    secondFactor.status === "not_enabled"
  ) {
    return secondFactor;
  }
  const [message, reason] = secondFactorRefusals[secondFactor.status];
  throw new VerifyChallengeError(message, reason);
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
      twoFactorEnabledAt: twoFactorRecordColumns.enabledAt,
      twoFactorFailedAttempts: twoFactorRecordColumns.failedAttempts,
      twoFactorLastUsedStep: twoFactorRecordColumns.lastUsedStep,
      twoFactorLockedUntil: twoFactorRecordColumns.lockedUntil,
      twoFactorRequiredOrganizationIds: twoFactorRequiredOrganizationIdsSql,
      twoFactorSecretCiphertext: twoFactorRecordColumns.secretCiphertext,
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
    .leftJoin(userTwoFactor, eq(userTwoFactor.userId, users.id))
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
  const signatureBytes = base64ToBytes(input.signature);

  if (!verify(signatureBytes, challengeBytes, publicKey)) {
    throw new VerifyChallengeError("Invalid signature", "invalid_signature");
  }
  // Checked only after the signature, so only the key holder learns of it.
  if (user.suspendedAt) {
    throw suspendedError();
  }

  // Also checked only after the signature: the code check counts toward a
  // lockout, which only the key holder may advance.
  const secondFactor = await requireSecondFactor(
    runtime,
    input,
    joinedTwoFactorRecord(user),
  );
  const session = await openLoginSession(runtime, {
    fingerprint: input.fingerprint,
    ipAddress: input.ipAddress,
    twoFactorRequiredOrganizationIds: user.twoFactorRequiredOrganizationIds,
    twoFactorVerified: secondFactor.status === "verified",
    userId: user.id,
  });
  if (session.status === "suspended") throw suspendedError();

  return {
    rootContainerId: user.rootContainerId,
    isRoot: user.isRoot,
    organizationId: user.defaultOrganizationId,
    sessionId: session.sessionId,
    token: session.token,
    twoFactorDeviceToken:
      secondFactor.status === "verified" ? secondFactor.deviceToken : null,
    userId: user.id,
  };
}
