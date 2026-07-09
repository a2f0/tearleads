import { compactId } from "./compactId";

const SELF_ATTRIBUTION_LABEL = "You";

export type ExplorerAttributionUserLabelResolver = (
  userId: string | null | undefined,
) => string | null;

interface ExplorerAttributionWriterIdentity {
  writerKeyFingerprint: string | null | undefined;
  writerUserId: string | null | undefined;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function getExplorerAttributionUserLabel(input: {
  currentUserId: string | null | undefined;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  userId: string | null | undefined;
}): string | null {
  const userId = trimNonEmpty(input.userId);
  if (!userId) {
    return null;
  }

  const displayName = trimNonEmpty(
    input.profileDisplayNamesByUserId.get(userId),
  );
  if (displayName) {
    return displayName;
  }

  return userId === input.currentUserId ? SELF_ATTRIBUTION_LABEL : null;
}

export function getExplorerAttributionWriterLabel(
  identity: ExplorerAttributionWriterIdentity,
  resolveUserLabel?: ExplorerAttributionUserLabelResolver | undefined,
): string {
  const userLabel = resolveUserLabel?.(identity.writerUserId) ?? null;
  if (userLabel) {
    return userLabel;
  }

  const fingerprint = trimNonEmpty(identity.writerKeyFingerprint);
  return fingerprint ? compactId(fingerprint) : "";
}

export function getExplorerAttributionWriterTitle(
  identity: ExplorerAttributionWriterIdentity,
  resolveUserLabel?: ExplorerAttributionUserLabelResolver | undefined,
): string | undefined {
  const userId = trimNonEmpty(identity.writerUserId);
  const fingerprint = trimNonEmpty(identity.writerKeyFingerprint);
  if (!userId || !fingerprint) {
    return undefined;
  }

  const userLabel = resolveUserLabel?.(userId) ?? null;
  return userLabel
    ? `${userLabel} · ${userId} · ${fingerprint}`
    : `${userId} · ${fingerprint}`;
}
