import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyHistoryEntryResponse,
  PrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import {
  PRINCIPAL_POLICY_HISTORY_GROUP_SCOPE_LIMIT,
  PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
} from "@tearleads/validators/util";
import { listPrincipalMemberEnvelopesForStates } from "../../access/read/principalMemberEnvelopes";
import {
  listPrincipalProjectionMembersForStates,
  listPrincipalStateHistoryPage,
  principalStateProjectionKey,
} from "../../access/read/principalStateStore";
import { listUserReachableCurrentGroupIds } from "../organizations/principalReachability";
import { toPrincipalStateResponse } from "./shared";

/**
 * A page of a principal's signed state history, scoped to this requester's own
 * tenure and their own envelopes.
 *
 * This is the recovery counterpart to the current-policy read.
 *
 * The state chain is served CONTIGUOUSLY, not filtered to the requester's own
 * tenure. Two reasons, and the first is the load-bearing one: each state names
 * its predecessor by `prevStateHash`, so a client can only verify that a state
 * genuinely belongs to this principal's signed history by checking it against
 * its neighbours. Filtering states out of the middle breaks that check and
 * would leave the client trusting whatever the server chose to send. Second,
 * the chain is not new disclosure — `getCurrentPrincipalPolicy` already ships
 * the whole of `previousStates`, with projections, to any authenticated
 * caller.
 *
 * What IS scoped is the key material: `memberEnvelopes` carry only envelopes
 * this requester could open. One member's envelope is not another's to read,
 * and recovery only ever needs the requester's own.
 *
 * A removed member therefore still recovers the epochs covering their tenure,
 * which is exactly the case this endpoint exists for: opening a container
 * envelope addressed to a principal key epoch that predates their removal.
 */
export async function runGetPrincipalPolicyHistoryWorkflow(input: {
  readonly beforeVersion: number | null;
  readonly database: ApiDatabase;
  readonly principalId: string;
  readonly principalType: "group" | "organization";
  readonly userId: string;
}): Promise<PrincipalPolicyHistoryResponse> {
  return input.database.transaction(async (tx) => {
    const page = await listPrincipalStateHistoryPage(
      {
        beforeVersion: input.beforeVersion,
        limit: PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
        principalId: input.principalId,
        principalType: input.principalType,
      },
      tx,
    );
    if (page.states.length === 0) {
      return {
        entries: [],
        hasMore: false,
        principalId: input.principalId,
        principalType: input.principalType,
      };
    }

    // One batched projection read for the page, not one per state.
    const projectionsByKey = await listPrincipalProjectionMembersForStates(
      input.principalType,
      page.states,
      tx,
    );
    const projectionFor = (state: (typeof page.states)[number]) =>
      projectionsByKey.get(principalStateProjectionKey(state)) ?? [];

    const groupIds = new Set<string>();
    for (const state of page.states) {
      for (const member of projectionFor(state)) {
        if (member.memberPrincipalType === "group") {
          groupIds.add(member.memberPrincipalId);
        }
      }
    }

    // One reachability walk for the whole page, not one per state — and the
    // candidate set is bounded BEFORE it enters that recursive query, since
    // every id becomes a bind parameter in it. Sorted first so which groups
    // survive the cap does not depend on projection iteration order.
    const reachableGroupIds = await listUserReachableCurrentGroupIds({
      executor: tx,
      groupIds: [...groupIds]
        .sort()
        .slice(0, PRINCIPAL_POLICY_HISTORY_GROUP_SCOPE_LIMIT),
      userId: input.userId,
    });

    const envelopesByStateHash = await listPrincipalMemberEnvelopesForStates(
      {
        memberGroupIds: [...reachableGroupIds],
        principalId: input.principalId,
        principalType: input.principalType,
        stateHashes: page.states.map((state) => state.stateHash),
        userId: input.userId,
      },
      tx,
    );

    const entries: PrincipalPolicyHistoryEntryResponse[] = page.states.map(
      (state) => ({
        memberEnvelopes: [...(envelopesByStateHash.get(state.stateHash) ?? [])],
        state: toPrincipalStateResponse(state),
      }),
    );

    return {
      entries,
      hasMore: page.hasMore,
      principalId: input.principalId,
      principalType: input.principalType,
    };
  });
}
