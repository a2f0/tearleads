import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";

export function compactRootIdentifier(
  value: string | null | undefined,
): string {
  if (!value) {
    return "None";
  }
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

export function formatRootTimestamp(value: string | null | undefined): string {
  return value ? formatMiniAppDateTime(value) : "Never";
}

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

/** Null when the draft is empty; undefined when it is not a fingerprint. */
export function parseFingerprintFilter(
  draft: string,
): string | null | undefined {
  const trimmed = draft.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return FINGERPRINT_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function describeRootFailure(failure: {
  readonly message: string;
  readonly status: number | null;
}): string {
  if (failure.status === 403) {
    return "The server no longer treats this session as root. Log in again.";
  }
  if (failure.status === 401) {
    return "The session has expired. Log in again.";
  }
  return failure.message;
}

export function describeThrown(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "The request could not be sent.";
}
