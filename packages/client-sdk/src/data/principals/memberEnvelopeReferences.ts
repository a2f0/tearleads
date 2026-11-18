import {
  compareCanonicalStrings,
  computePrincipalMemberEnvelopesRoot,
  computePrincipalStateHash,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { PrincipalPolicyBundleRepository } from "../persistence/principalPolicy/principalPolicyBundleRepository";
import type { ExecSql } from "../sqlite/sqlSchema";
import type { AuthoredPrincipalMutation } from "./principalMutationJournalShape";

type Envelope = PutPrincipalPolicyRequest["memberEnvelopes"][number];

const ENVELOPE_FIELDS = 4;

/**
 * Field-for-field equal, and with no field beyond the signed four: the server
 * rebuilds retained envelopes from its stored rows, so an envelope carrying
 * anything else is sent whole.
 */
function sameEnvelope(left: Envelope, right: Envelope): boolean {
  return (
    Object.keys(left).length === ENVELOPE_FIELDS &&
    Object.keys(right).length === ENVELOPE_FIELDS &&
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
  // A set that names a user twice goes whole, so the server sees exactly it.
  const next = new Set(leg.memberEnvelopes.map((envelope) => envelope.userId));
  if (
    next.size !== leg.memberEnvelopes.length ||
    heldEnvelopes.size !== predecessor.currentMemberEnvelopes.envelopes.length
  )
    return leg;
  const upsert = leg.memberEnvelopes.filter((envelope) => {
    const heldEnvelope = heldEnvelopes.get(envelope.userId);
    return !heldEnvelope || !sameEnvelope(heldEnvelope, envelope);
  });
  if (upsert.length === leg.memberEnvelopes.length) return leg;
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
  const bundle = await repository.loadStoredPrincipalPolicyBundle(
    leg.state.principalType,
    leg.state.principalId,
  );
  if (bundle?.currentState.stateHash !== leg.state.prevStateHash) return null;
  // The cached state must hash to the cited one and its envelopes to its
  // signed root, or the changes would be computed against another set.
  return (await computePrincipalStateHash(bundle.currentState)) ===
    leg.state.prevStateHash &&
    (await computePrincipalMemberEnvelopesRoot(
      bundle.currentMemberEnvelopes.envelopes,
    )) === bundle.currentState.memberEnvelopesRoot
    ? bundle
    : null;
}

/**
 * The wire form of a journaled mutation; the journal keeps it in full. It is
 * `mutation` itself when no leg goes by reference.
 */
export async function withHeldMemberEnvelopeChanges(
  execSql: ExecSql,
  mutation: AuthoredPrincipalMutation,
): Promise<AuthoredPrincipalMutation> {
  const wire = await wireForm(execSql, mutation);
  return legsOf(wire).some((leg, index) => leg !== legsOf(mutation)[index])
    ? wire
    : mutation;
}

/**
 * The journal keeps full lists only: changes are a wire form derived per
 * attempt, so recovery never depends on an API that reads them.
 */
export function assertFullMemberEnvelopeLists(
  mutation: AuthoredPrincipalMutation,
): void {
  if (legsOf(mutation).some((leg) => leg?.memberEnvelopeChanges !== undefined))
    throw new Error(
      "Principal mutations are journaled with full member envelope lists",
    );
}

function legsOf(
  mutation: AuthoredPrincipalMutation,
): ReadonlyArray<PutPrincipalPolicyRequest | undefined> {
  switch (mutation.kind) {
    case "compound":
      return [
        mutation.request.groupPolicy,
        mutation.request.memberPolicy,
        mutation.request.organizationPolicy,
      ];
    case "group-create":
    case "group-delete":
      return [mutation.request.organizationPolicy];
    case "organization":
      return [mutation.request];
  }
}

async function wireForm(
  execSql: ExecSql,
  mutation: AuthoredPrincipalMutation,
): Promise<AuthoredPrincipalMutation> {
  const repository = new PrincipalPolicyBundleRepository(execSql);
  // The cache is optional: any failure to read or check it sends the leg in
  // full rather than leaving the journaled request unsent.
  const compact = async (leg: PutPrincipalPolicyRequest) => {
    try {
      const predecessor = await heldPredecessor(repository, leg);
      return predecessor ? withMemberEnvelopeChanges(leg, predecessor) : leg;
    } catch {
      return leg;
    }
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

function sortedLeg(leg: PutPrincipalPolicyRequest): PutPrincipalPolicyRequest {
  const memberEnvelopes = [...leg.memberEnvelopes].sort((left, right) =>
    compareCanonicalStrings(left.userId, right.userId),
  );
  return memberEnvelopes.every(
    (envelope, index) => envelope === leg.memberEnvelopes[index],
  )
    ? leg
    : { ...leg, memberEnvelopes };
}

/**
 * Every leg's envelope list in user-id order, the order the API keys receipts
 * by (#2903 P17): an API of any version then keys a retry of this request
 * exactly as it keyed the first attempt. `mutation` itself when already so.
 */
export function withCanonicalEnvelopeOrder(
  mutation: AuthoredPrincipalMutation,
): AuthoredPrincipalMutation {
  switch (mutation.kind) {
    case "compound": {
      const { groupPolicy, memberPolicy, organizationPolicy } =
        mutation.request;
      const sorted = {
        ...mutation.request,
        groupPolicy: sortedLeg(groupPolicy),
        ...(memberPolicy ? { memberPolicy: sortedLeg(memberPolicy) } : {}),
        organizationPolicy: sortedLeg(organizationPolicy),
      };
      return sorted.groupPolicy === groupPolicy &&
        sorted.memberPolicy === memberPolicy &&
        sorted.organizationPolicy === organizationPolicy
        ? mutation
        : { ...mutation, request: sorted };
    }
    case "group-create": {
      const organizationPolicy = sortedLeg(mutation.request.organizationPolicy);
      const initialGroupPolicy = sortedLeg(mutation.request.initialGroupPolicy);
      return organizationPolicy === mutation.request.organizationPolicy &&
        initialGroupPolicy === mutation.request.initialGroupPolicy
        ? mutation
        : {
            ...mutation,
            request: {
              ...mutation.request,
              initialGroupPolicy,
              organizationPolicy,
            },
          };
    }
    case "group-delete": {
      const organizationPolicy = sortedLeg(mutation.request.organizationPolicy);
      return organizationPolicy === mutation.request.organizationPolicy
        ? mutation
        : { ...mutation, request: { ...mutation.request, organizationPolicy } };
    }
    case "organization": {
      const request = sortedLeg(mutation.request);
      return request === mutation.request ? mutation : { ...mutation, request };
    }
  }
}
