import { computePrincipalMemberEnvelopesRoot } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { PrincipalPolicyBundleRepository } from "../persistence/principalPolicy/principalPolicyBundleRepository";
import type { ExecSql } from "../sqlite/sqlSchema";
import type { AuthoredPrincipalMutation } from "./principalMutationJournalShape";

type Envelope = PutPrincipalPolicyRequest["memberEnvelopes"][number];

function sameEnvelope(left: Envelope, right: Envelope): boolean {
  return (
    left.userId === right.userId &&
    left.memberKeyFingerprint === right.memberKeyFingerprint &&
    left.kemCipherText === right.kemCipherText &&
    left.wrappedKey === right.wrappedKey
  );
}

/**
 * A leg in its predecessor's key epoch, with its member envelopes sent as
 * changes to the predecessor's set (#2903 P17): the removed users and the
 * added or replaced envelopes, with an empty list. The server rebuilds the
 * full set from the envelopes it stored for the predecessor and checks the
 * signed root. Any other leg, or one that retains no envelope, goes in full.
 */
export function withMemberEnvelopeChanges(
  leg: PutPrincipalPolicyRequest,
  predecessor: PrincipalPolicyBundleResponse,
): PutPrincipalPolicyRequest {
  const held = predecessor.currentState;
  if (
    leg.memberEnvelopeChanges !== undefined ||
    leg.state.prevStateHash !== held.stateHash ||
    leg.state.keyEpoch !== held.keyEpoch ||
    leg.state.keyFingerprint !== held.keyFingerprint
  )
    return leg;
  const heldEnvelopes = new Map(
    predecessor.currentMemberEnvelopes.envelopes.map((envelope) => [
      envelope.userId,
      envelope,
    ]),
  );
  const upsert = leg.memberEnvelopes.filter((envelope) => {
    const heldEnvelope = heldEnvelopes.get(envelope.userId);
    return !heldEnvelope || !sameEnvelope(heldEnvelope, envelope);
  });
  if (upsert.length === leg.memberEnvelopes.length) return leg;
  const next = new Set(leg.memberEnvelopes.map((envelope) => envelope.userId));
  return {
    ...leg,
    memberEnvelopeChanges: {
      removeUserIds: [...heldEnvelopes.keys()].filter(
        (userId) => !next.has(userId),
      ),
      upsert,
    },
    memberEnvelopes: [],
  };
}

/**
 * The predecessor this device holds for `leg`: its cached current bundle when
 * that is the cited state and its envelopes match their signed root, so the
 * changes rebuild against exactly the set the server stored. A miss sends the
 * leg in full.
 */
async function heldPredecessor(
  repository: PrincipalPolicyBundleRepository,
  leg: PutPrincipalPolicyRequest,
): Promise<PrincipalPolicyBundleResponse | null> {
  if (leg.state.prevStateHash === null) return null;
  const bundle = await repository.loadPrincipalPolicyBundle(
    leg.state.principalType,
    leg.state.principalId,
  );
  if (bundle?.currentState.stateHash !== leg.state.prevStateHash) return null;
  return (await computePrincipalMemberEnvelopesRoot(
    bundle.currentMemberEnvelopes.envelopes,
  )) === bundle.currentState.memberEnvelopesRoot
    ? bundle
    : null;
}

/** The wire form of a journaled mutation; the journal keeps it in full. */
export async function withHeldMemberEnvelopeChanges(
  execSql: ExecSql,
  mutation: AuthoredPrincipalMutation,
): Promise<AuthoredPrincipalMutation> {
  const repository = new PrincipalPolicyBundleRepository(execSql);
  const compact = async (leg: PutPrincipalPolicyRequest) => {
    const predecessor = await heldPredecessor(repository, leg);
    return predecessor ? withMemberEnvelopeChanges(leg, predecessor) : leg;
  };
  switch (mutation.kind) {
    case "compound": {
      const { memberPolicy } = mutation.request;
      return {
        ...mutation,
        request: {
          ...mutation.request,
          groupPolicy: await compact(mutation.request.groupPolicy),
          ...(memberPolicy
            ? { memberPolicy: await compact(memberPolicy) }
            : {}),
          organizationPolicy: await compact(
            mutation.request.organizationPolicy,
          ),
        },
      };
    }
    case "group-create":
      return {
        ...mutation,
        request: {
          ...mutation.request,
          organizationPolicy: await compact(
            mutation.request.organizationPolicy,
          ),
        },
      };
    case "group-delete":
      return {
        ...mutation,
        request: {
          ...mutation.request,
          organizationPolicy: await compact(
            mutation.request.organizationPolicy,
          ),
        },
      };
    case "organization":
      return { ...mutation, request: await compact(mutation.request) };
  }
}
