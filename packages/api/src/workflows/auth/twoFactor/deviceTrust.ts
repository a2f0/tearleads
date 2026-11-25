import { bytesToHex, generateChallenge } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { sha256Hex } from "../../../utils/sha256";

const DEVICE_TRUST_PREFIX = "two-factor-device:";
const DEVICE_TRUST_TTL_SECONDS = 30 * 24 * 60 * 60;

interface DeviceTrustStore {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (
    key: string,
    value: string,
    ttlSeconds?: number,
  ) => Promise<void>;
}

/**
 * A remembered device stands in for a code until it expires. The store keeps
 * only the token's hash, keyed to the user and the moment two-factor was
 * turned on, so turning it off (or off and on again) forgets every device.
 */
interface DeviceTrustRecord {
  readonly enabledAt: number;
  readonly userId: string;
}

function deviceTrustKey(token: string): string {
  return `${DEVICE_TRUST_PREFIX}${sha256Hex(token)}`;
}

export async function issueTwoFactorDeviceToken(
  store: Pick<DeviceTrustStore, "set">,
  input: { readonly enabledAt: Date; readonly userId: string },
): Promise<string> {
  const token = bytesToHex(generateChallenge(32));
  const record: DeviceTrustRecord = {
    enabledAt: input.enabledAt.getTime(),
    userId: input.userId,
  };
  await store.set(
    deviceTrustKey(token),
    JSON.stringify(record),
    DEVICE_TRUST_TTL_SECONDS,
  );
  return token;
}

export async function isTrustedTwoFactorDevice(
  store: Pick<DeviceTrustStore, "get">,
  input: {
    readonly enabledAt: Date;
    readonly token: string;
    readonly userId: string;
  },
): Promise<boolean> {
  const raw = await store.get(deviceTrustKey(input.token));
  if (!raw) return false;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isPlainObject(record)) return false;
  const { enabledAt, userId } = record;
  return userId === input.userId && enabledAt === input.enabledAt.getTime();
}
