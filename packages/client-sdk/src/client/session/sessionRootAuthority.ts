import { KeyingVerificationError } from "@tearleads/crypto";
import { reportKeyingVerificationErrorInCauseChain } from "../../data/keyingProjectionVerification/error";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { Session, SessionContext, SessionSnapshot } from "./sessionTypes";

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

/**
 * Decides and commits an acknowledgement against the session's CURRENT
 * snapshot in one synchronous step: reading `rootAcknowledgments`, deciding,
 * and `setContext` happen with no await between them, so an overlapping login,
 * registration or organization creation can never overwrite this entry with a
 * stale copy (a lost acknowledgement would erase that organization's root-swap
 * protection). Only the incident report for a refusal is asynchronous, and it
 * runs after the decision has been made and before the error propagates.
 */
export async function commitSessionRootAcknowledgment(input: {
  readonly context?: Omit<SessionContext, "rootAcknowledgments"> | undefined;
  readonly reporter: SecurityIncidentReporter | undefined;
  readonly root: RootAcknowledgmentInput;
  readonly session: Pick<Session, "setContext" | "snapshot">;
  readonly signingFingerprint: string | null;
}): Promise<void> {
  const { context, reporter, root, session, signingFingerprint } = input;
  let rootAcknowledgments: RootAcknowledgments;
  try {
    rootAcknowledgments = acknowledgeSessionRoot(
      session.snapshot.rootAcknowledgments,
      root,
      signingFingerprint,
    );
  } catch (error) {
    if (signingFingerprint) {
      await reportKeyingVerificationErrorInCauseChain(error, reporter, {
        objectId: root.rootContainerId,
        objectKind: "container",
        operation: "session.root.acknowledge",
        organizationId: root.organizationId,
      });
    }
    throw error;
  }
  session.setContext({ ...context, rootAcknowledgments });
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
