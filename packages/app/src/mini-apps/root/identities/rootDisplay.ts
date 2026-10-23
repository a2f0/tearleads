import { MIN_ROOT_FINGERPRINT_PREFIX_LENGTH } from "@tearleads/validators/operation";
import { isUuidV4String } from "@tearleads/validators/util";
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

export function formatRootTimestamp(
  value: string | null | undefined,
  missing = "Never",
): string {
  return value ? formatMiniAppDateTime(value) : missing;
}

/** A listing filter; `fingerprint` may be any long enough leading part. */
export type RootIdentityFilter =
  | { readonly fingerprint: string }
  | { readonly userId: string };

const FINGERPRINT_PREFIX_PATTERN = new RegExp(
  `^[0-9a-f]{${MIN_ROOT_FINGERPRINT_PREFIX_LENGTH},64}$`,
  "u",
);

/** Lowercased and trimmed, the form two drafts are compared in. */
export function normalizeIdentityFilterDraft(draft: string): string {
  return draft.trim().toLowerCase();
}

/**
 * Null when the draft is empty; undefined when it is neither a user ID nor a
 * long enough signing key fingerprint prefix.
 */
export function parseIdentityFilter(
  draft: string,
): RootIdentityFilter | null | undefined {
  const normalized = normalizeIdentityFilterDraft(draft);
  if (normalized.length === 0) {
    return null;
  }
  if (isUuidV4String(normalized)) {
    return { userId: normalized };
  }
  return FINGERPRINT_PREFIX_PATTERN.test(normalized)
    ? { fingerprint: normalized }
    : undefined;
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
