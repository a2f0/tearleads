import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { TwoFactorLoginCode } from "@tearleads/validators/request";
import { checkSecondFactorCode } from "./codeCheck";
import {
  issueTwoFactorDeviceToken,
  isTrustedTwoFactorDevice,
} from "./deviceTrust";
import type { TwoFactorRecord } from "./store";

export type LoginSecondFactor =
  | { readonly status: "not_enabled" }
  | { readonly status: "verified"; readonly deviceToken: string | null }
  | { readonly status: "required" }
  | { readonly status: "invalid" }
  | { readonly status: "locked" };

interface DeviceTrustStore {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (
    key: string,
    value: string,
    ttlSeconds?: number,
  ) => Promise<void>;
}

/**
 * The second factor of a sign-in whose signature already verified. A typed
 * code takes precedence over a device token; a wrong code is refused even
 * when the device token alone would have passed.
 */
export async function resolveLoginSecondFactor(input: {
  readonly answer: TwoFactorLoginCode | undefined;
  readonly deviceToken: string | undefined;
  readonly deviceTrust: DeviceTrustStore;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly record: TwoFactorRecord | null;
  readonly serverSecret: string;
}): Promise<LoginSecondFactor> {
  const { record } = input;
  const enabledAt = record?.enabledAt;
  if (!record || !enabledAt) {
    return { status: "not_enabled" };
  }
  if (input.answer) {
    const outcome = await checkSecondFactorCode({
      answer: input.answer,
      executor: input.executor,
      now: input.now,
      record,
      serverSecret: input.serverSecret,
    });
    if (outcome.status !== "verified") return outcome;
    return {
      deviceToken: input.answer.rememberDevice
        ? await issueTwoFactorDeviceToken(input.deviceTrust, {
            enabledAt,
            userId: record.userId,
          })
        : null,
      status: "verified",
    };
  }
  if (
    input.deviceToken &&
    (await isTrustedTwoFactorDevice(input.deviceTrust, {
      enabledAt,
      token: input.deviceToken,
      userId: record.userId,
    }))
  ) {
    return { deviceToken: null, status: "verified" };
  }
  return { status: "required" };
}
