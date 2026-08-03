import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyHistoryEntryResponse,
  PrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";
import { listPrincipalMemberEnvelopesForStates } from "../../access/read/principalMemberEnvelopes";
import {
  listPrincipalGroupMemberCandidates,
  listPrincipalStateHistoryPage,
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

    // The group candidates come back already bounded and deduped from SQL, so
    // the page's full projection never reaches the application — a state's
    // member list has no server-side bound, and this endpoint's whole point is
    // being bounded.
    const groupIds = await listPrincipalGroupMemberCandidates(
      {
        principalId: input.principalId,
        principalType: input.principalType,
        stateHashes: page.states.map((state) => state.stateHash),
      },
      tx,
    );

    // One reachability walk for the whole page, not one per state.
    const reachableGroupIds = await listUserReachableCurrentGroupIds({
      executor: tx,
      groupIds,
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
