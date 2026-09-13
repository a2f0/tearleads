import { KeyingVerificationError } from "@tearleads/crypto";
import { reportKeyingVerificationErrorInCauseChain } from "../../data/keyingProjectionVerification/error";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { Session, SessionSnapshot } from "./sessionTypes";

type RootAcknowledgments = SessionSnapshot["rootAcknowledgments"];
type RootAcknowledgmentInput = Omit<
  RootAcknowledgments[number],
  "signingFingerprint"
>;

/**
 * The login, registration and organization-creation responses that carry a
 * root id are unsigned. An organization's root row is created once, in the
 * provisioning transaction, and only ever disappears through a purge, so an
 * honest server can re-acknowledge the same root or report it gone (null) but
 * never presents a different root for an organization this identity already
 * acknowledged. A different id is a substitution attempt: the previous root
 * stays authoritative and the caller records a security incident.
 */
function assertRootAcknowledgmentUnchanged(
  previous: RootAcknowledgments[number] | undefined,
  input: RootAcknowledgmentInput,
): void {
  if (
    !previous ||
    previous.rootContainerId === input.rootContainerId ||
    input.rootContainerId === null
  ) {
    return;
  }
  throw new KeyingVerificationError(
    "object_mismatch",
    "Session root acknowledgement changed for an acknowledged organization",
  );
}

export function acknowledgeSessionRoot(
  known: RootAcknowledgments,
  input: RootAcknowledgmentInput,
  signingFingerprint: string | null,
): RootAcknowledgments {
  if (!signingFingerprint)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Session root acknowledgement requires a signing identity",
    );
  const matchesIdentity = (entry: RootAcknowledgments[number]) =>
    entry.signingFingerprint === signingFingerprint &&
    entry.userId === input.userId;
  assertRootAcknowledgmentUnchanged(
    known.find(
      (entry) =>
        matchesIdentity(entry) && entry.organizationId === input.organizationId,
    ),
    input,
  );
  return [
    ...known.filter(
      (entry) =>
        matchesIdentity(entry) && entry.organizationId !== input.organizationId,
    ),
    {
      userId: input.userId,
      organizationId: input.organizationId,
      rootContainerId: input.rootContainerId,
      signingFingerprint,
    },
  ];
}

/** Records a refused acknowledgement as an incident before failing the login. */
export async function acknowledgeSessionRootReported(
  reporter: SecurityIncidentReporter | undefined,
  known: RootAcknowledgments,
  input: RootAcknowledgmentInput,
  signingFingerprint: string | null,
): Promise<RootAcknowledgments> {
  try {
    return acknowledgeSessionRoot(known, input, signingFingerprint);
  } catch (error) {
    if (signingFingerprint) {
      await reportKeyingVerificationErrorInCauseChain(error, reporter, {
        objectId: input.rootContainerId,
        objectKind: "container",
        operation: "session.root.acknowledge",
        organizationId: input.organizationId,
      });
    }
    throw error;
  }
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
