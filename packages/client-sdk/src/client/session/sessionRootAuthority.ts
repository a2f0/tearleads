import { KeyingVerificationError } from "@tearleads/crypto";
import type { Session, SessionSnapshot } from "./sessionTypes";

type RootAcknowledgments = SessionSnapshot["rootAcknowledgments"];

export function acknowledgeSessionRoot(
  known: RootAcknowledgments,
  input: Omit<RootAcknowledgments[number], "signingFingerprint">,
  signingFingerprint: string | null,
): RootAcknowledgments {
  if (!signingFingerprint)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Session root acknowledgement requires a signing identity",
    );
  return [
    ...known.filter(
      (entry) =>
        entry.signingFingerprint === signingFingerprint &&
        entry.userId === input.userId &&
        entry.organizationId !== input.organizationId,
    ),
    {
      userId: input.userId,
      organizationId: input.organizationId,
      rootContainerId: input.rootContainerId,
      signingFingerprint,
    },
  ];
}

/** Only the encrypted host restore may supply previously acknowledged roots. */
export function restoreSessionRoots(
  known: RootAcknowledgments,
  restored: RootAcknowledgments | undefined,
  signingFingerprint: string | null,
  userId: string | null,
): RootAcknowledgments {
  const matches = (entry: RootAcknowledgments[number]) =>
    entry.signingFingerprint === signingFingerprint && entry.userId === userId;
  if (restored) {
    if (
      !restored.every(matches) ||
      new Set(restored.map((entry) => entry.organizationId)).size !==
        restored.length
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Restored roots differ from the active identity",
      );
    }
    return restored.map((entry) => ({ ...entry }));
  }
  return known.every(matches) ? known : known.filter(matches);
}

export function acknowledgedSessionRoot(
  session: Session,
  signingFingerprint: string | null,
): string | null {
  return (
    session.snapshot.rootAcknowledgments.find(
      (entry) =>
        entry.signingFingerprint === signingFingerprint &&
        entry.userId === session.userId &&
        entry.organizationId === session.organizationId,
    )?.rootContainerId ?? null
  );
}
