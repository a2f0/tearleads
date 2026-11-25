import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { TwoFactorMethod } from "@tearleads/validators/request";
import { recoveryCodeHash } from "./recoveryCodes";
import { openTwoFactorSecret } from "./secretSeal";
import {
  acceptTotpStep,
  consumeRecoveryCode,
  recordFailedCode,
  type TwoFactorRecord,
} from "./store";
import { matchTotpStep, normalizeTotpCode } from "./totp";

export type SecondFactorCodeOutcome =
  | { readonly status: "verified" }
  | { readonly status: "invalid" }
  | { readonly status: "locked" };

export interface SecondFactorAnswer {
  readonly code: string;
  readonly method: TwoFactorMethod;
}

async function acceptsCode(input: {
  readonly answer: SecondFactorAnswer;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly record: TwoFactorRecord;
  readonly serverSecret: string;
}): Promise<boolean> {
  const { answer, executor, now, record } = input;
  if (answer.method === "recovery_code") {
    const codeHash = recoveryCodeHash(answer.code, {
      serverSecret: input.serverSecret,
      userId: record.userId,
    });
    return (
      codeHash !== null &&
      (await consumeRecoveryCode(executor, {
        codeHash,
        now,
        userId: record.userId,
      }))
    );
  }
  const code = normalizeTotpCode(answer.code);
  if (!code) return false;
  const step = matchTotpStep({
    code,
    lastUsedStep: record.lastUsedStep,
    nowMs: now.getTime(),
    secret: await openTwoFactorSecret({
      sealed: record.secretCiphertext,
      serverSecret: input.serverSecret,
      userId: record.userId,
    }),
  });
  return (
    step !== null &&
    (await acceptTotpStep(executor, {
      enabling: false,
      now,
      step,
      userId: record.userId,
    })) !== null
  );
}

/**
 * Checks an authenticator or recovery code against a turned-on record. A
 * wrong code counts toward the lockout; a locked record refuses every code,
 * right or wrong, until the lockout ends.
 */
export async function checkSecondFactorCode(input: {
  readonly answer: SecondFactorAnswer;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly record: TwoFactorRecord;
  readonly serverSecret: string;
}): Promise<SecondFactorCodeOutcome> {
  if (input.record.lockedUntil && input.record.lockedUntil > input.now) {
    return { status: "locked" };
  }
  if (await acceptsCode(input)) {
    return { status: "verified" };
  }
  const lockedUntil = await recordFailedCode(input.executor, {
    now: input.now,
    userId: input.record.userId,
  });
  return lockedUntil ? { status: "locked" } : { status: "invalid" };
}
