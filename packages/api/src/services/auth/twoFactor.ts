import type {
  TwoFactorConfirmationRequest,
  TwoFactorEnableRequest,
} from "@tearleads/validators/request";
import {
  TWO_FACTOR_ERROR_CODES,
  type TwoFactorEnableResponse,
  type TwoFactorErrorCode,
  type TwoFactorRecoveryCodesResponse,
  type TwoFactorSetupResponse,
  type TwoFactorStatusResponse,
} from "@tearleads/validators/response";
import { checkSecondFactorCode } from "../../workflows/auth/twoFactor/codeCheck";
import { issueTwoFactorDeviceToken } from "../../workflows/auth/twoFactor/deviceTrust";
import { generateRecoveryCodes } from "../../workflows/auth/twoFactor/recoveryCodes";
import {
  openTwoFactorSecret,
  sealTwoFactorSecret,
} from "../../workflows/auth/twoFactor/secretSeal";
import {
  acceptTotpStep,
  countRecoveryCodes,
  deleteTwoFactor,
  loadTwoFactorRecord,
  recordFailedCode,
  replaceRecoveryCodes,
  savePendingTwoFactorSecret,
  type TwoFactorRecord,
} from "../../workflows/auth/twoFactor/store";
import {
  encodeBase32,
  generateTotpSecret,
  matchTotpStep,
  normalizeTotpCode,
  totpUri,
} from "../../workflows/auth/twoFactor/totp";
import type { ApiServiceRuntime } from "../runtime";

const TOTP_ISSUER = "Tearleads";
/** Enough of the signing fingerprint to tell identities apart in an app. */
const ACCOUNT_NAME_FINGERPRINT_CHARS = 8;

export class TwoFactorRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 429,
    readonly code: TwoFactorErrorCode,
  ) {
    super(message);
  }
}

function invalidCode(): TwoFactorRequestError {
  return new TwoFactorRequestError(
    "That code did not match",
    400,
    TWO_FACTOR_ERROR_CODES.invalidCode,
  );
}

function lockedOut(): TwoFactorRequestError {
  return new TwoFactorRequestError(
    "Too many invalid codes; try again later",
    429,
    TWO_FACTOR_ERROR_CODES.locked,
  );
}

function notEnabled(): TwoFactorRequestError {
  return new TwoFactorRequestError(
    "Two-factor authentication is not turned on",
    409,
    TWO_FACTOR_ERROR_CODES.notEnabled,
  );
}

/** The session store calls that turning two-factor on or off makes. */
export interface TwoFactorSessionStore {
  readonly destroyUserSession: (input: {
    sessionId: string;
    userId: string;
  }) => Promise<boolean>;
  readonly listUserSessions: (input: {
    currentToken: string;
    userId: string;
  }) => Promise<readonly { readonly id: string }[]>;
  readonly updateSessionTwoFactorStanding: (input: {
    readonly sessionToken: string;
    readonly standing: {
      readonly twoFactorRequiredOrganizationIds: readonly string[];
      readonly twoFactorVerified: boolean;
    };
  }) => Promise<boolean>;
}

export interface TwoFactorCaller {
  readonly fingerprint: string;
  /** Organizations whose requirement this session's standing records. */
  readonly requiredOrganizationIds: readonly string[];
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly sessionVerified: boolean;
  readonly userId: string;
}

async function revokeUserSessions(
  sessions: TwoFactorSessionStore,
  userId: string,
  keepSessionId: string | null,
): Promise<void> {
  const live = await sessions.listUserSessions({ currentToken: "", userId });
  await Promise.all(
    live
      .filter((session) => session.id !== keepSessionId)
      .map((session) =>
        sessions.destroyUserSession({ sessionId: session.id, userId }),
      ),
  );
}

export async function getTwoFactorStatus(
  runtime: ApiServiceRuntime,
  caller: TwoFactorCaller,
): Promise<TwoFactorStatusResponse> {
  const record = await loadTwoFactorRecord(runtime.db, caller.userId);
  const enabled = Boolean(record?.enabledAt);
  return {
    enabled,
    recoveryCodesRemaining: enabled
      ? await countRecoveryCodes(runtime.db, caller.userId)
      : 0,
    requiredByOrganizationIds: caller.sessionVerified
      ? []
      : [...caller.requiredOrganizationIds],
    sessionVerified: caller.sessionVerified,
  };
}

export async function beginTwoFactorSetup(
  runtime: ApiServiceRuntime,
  caller: TwoFactorCaller,
): Promise<TwoFactorSetupResponse> {
  const secret = generateTotpSecret();
  const saved = await savePendingTwoFactorSecret(runtime.db, {
    now: new Date(),
    secretCiphertext: await sealTwoFactorSecret({
      secret,
      serverSecret: runtime.documentSyncCursorHmacKey,
      userId: caller.userId,
    }),
    userId: caller.userId,
  });
  if (!saved) {
    throw new TwoFactorRequestError(
      "Two-factor authentication is already turned on",
      409,
      TWO_FACTOR_ERROR_CODES.alreadyEnabled,
    );
  }
  return {
    otpauthUri: totpUri({
      accountName: caller.fingerprint.slice(0, ACCOUNT_NAME_FINGERPRINT_CHARS),
      issuer: TOTP_ISSUER,
      secret,
    }),
    secret: encodeBase32(secret),
  };
}

async function requirePendingRecord(
  runtime: ApiServiceRuntime,
  userId: string,
  now: Date,
): Promise<TwoFactorRecord> {
  const record = await loadTwoFactorRecord(runtime.db, userId);
  if (!record) {
    throw new TwoFactorRequestError(
      "Start authenticator setup first",
      409,
      TWO_FACTOR_ERROR_CODES.setupMissing,
    );
  }
  if (record.enabledAt) {
    throw new TwoFactorRequestError(
      "Two-factor authentication is already turned on",
      409,
      TWO_FACTOR_ERROR_CODES.alreadyEnabled,
    );
  }
  if (record.lockedUntil && record.lockedUntil > now) throw lockedOut();
  return record;
}

/**
 * Confirms the pending secret with a code and turns two-factor on: the
 * calling session counts as verified and every other session is revoked, so
 * each other device signs in again with a code.
 */
export async function enableTwoFactor(
  runtime: ApiServiceRuntime,
  sessions: TwoFactorSessionStore,
  caller: TwoFactorCaller,
  request: TwoFactorEnableRequest,
): Promise<TwoFactorEnableResponse> {
  const now = new Date();
  const record = await requirePendingRecord(runtime, caller.userId, now);
  const code = normalizeTotpCode(request.code);
  const step =
    code === null
      ? null
      : matchTotpStep({
          code,
          lastUsedStep: record.lastUsedStep,
          nowMs: now.getTime(),
          secret: await openTwoFactorSecret({
            sealed: record.secretCiphertext,
            serverSecret: runtime.documentSyncCursorHmacKey,
            userId: caller.userId,
          }),
        });
  const recoveryCodes = generateRecoveryCodes();
  const enabledAt =
    step === null
      ? null
      : await runtime.db.transaction(async (tx) => {
          const accepted = await acceptTotpStep(tx, {
            enabling: true,
            now,
            step,
            userId: caller.userId,
          });
          if (accepted) {
            await replaceRecoveryCodes(tx, {
              hashes: recoveryCodes.hashes,
              now,
              userId: caller.userId,
            });
          }
          return accepted;
        });
  if (!enabledAt) {
    const lockedUntil = await recordFailedCode(runtime.db, {
      now,
      userId: caller.userId,
    });
    throw lockedUntil ? lockedOut() : invalidCode();
  }

  await sessions.updateSessionTwoFactorStanding({
    sessionToken: caller.sessionToken,
    standing: { twoFactorRequiredOrganizationIds: [], twoFactorVerified: true },
  });
  await revokeUserSessions(sessions, caller.userId, caller.sessionId);
  const deviceToken = request.rememberDevice
    ? await issueTwoFactorDeviceToken(runtime.keyValueStore, {
        enabledAt,
        userId: caller.userId,
      })
    : null;
  return {
    enabled: true,
    recoveryCodes: [...recoveryCodes.codes],
    ...(deviceToken === null ? {} : { deviceToken }),
  };
}

async function requireConfirmedCaller(
  runtime: ApiServiceRuntime,
  caller: TwoFactorCaller,
  request: TwoFactorConfirmationRequest,
): Promise<void> {
  const record = await loadTwoFactorRecord(runtime.db, caller.userId);
  if (!record?.enabledAt) throw notEnabled();
  const outcome = await checkSecondFactorCode({
    answer: request,
    executor: runtime.db,
    now: new Date(),
    record,
    serverSecret: runtime.documentSyncCursorHmacKey,
  });
  if (outcome.status === "locked") throw lockedOut();
  if (outcome.status === "invalid") throw invalidCode();
}

/**
 * Turns two-factor off after a code, forgetting the secret, the recovery
 * codes, and (through the changed record) every remembered device. Every
 * session is revoked, the caller's too: each renews silently with a standing
 * that again carries the organizations requiring two-factor.
 */
export async function disableTwoFactor(
  runtime: ApiServiceRuntime,
  sessions: TwoFactorSessionStore,
  caller: TwoFactorCaller,
  request: TwoFactorConfirmationRequest,
): Promise<TwoFactorStatusResponse> {
  await requireConfirmedCaller(runtime, caller, request);
  await runtime.db.transaction((tx) => deleteTwoFactor(tx, caller.userId));
  await revokeUserSessions(sessions, caller.userId, null);
  // The caller's session is gone; its renewal reports the standing afresh.
  return {
    enabled: false,
    recoveryCodesRemaining: 0,
    requiredByOrganizationIds: [],
    sessionVerified: false,
  };
}

export async function regenerateTwoFactorRecoveryCodes(
  runtime: ApiServiceRuntime,
  caller: TwoFactorCaller,
  request: TwoFactorConfirmationRequest,
): Promise<TwoFactorRecoveryCodesResponse> {
  await requireConfirmedCaller(runtime, caller, request);
  const recoveryCodes = generateRecoveryCodes();
  await runtime.db.transaction((tx) =>
    replaceRecoveryCodes(tx, {
      hashes: recoveryCodes.hashes,
      now: new Date(),
      userId: caller.userId,
    }),
  );
  return { recoveryCodes: [...recoveryCodes.codes] };
}
