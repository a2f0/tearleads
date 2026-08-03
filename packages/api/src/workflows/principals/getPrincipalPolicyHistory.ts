import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyHistoryEntryResponse,
  PrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "@tearleads/validators/util";
import { listPrincipalMemberEnvelopesForStates } from "../../access/read/principalMemberEnvelopes";
import { listPrincipalStateHistoryPage } from "../../access/read/principalStateStore";
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
 * What IS scoped is the key material: `memberEnvelopes` carry ONLY the
 * requester's own direct user envelopes. Group-addressed envelopes are
 * deliberately never served, and that is a security boundary rather than a
 * simplification.
 *
 * Serving them would require knowing whether the requester was in that group
 * at that state. Current membership is not a safe proxy: a user who joins
 * group G today would be handed every envelope this principal ever addressed
 * to G, and an additive join need not rotate G's key, so they could open
 * principal key epochs from before they had any access. Resolving historical
 * tenure needs the same history walk applied recursively at authorization
 * time — issue #1948.
 *
 * The primary case does not need them. Opening a container envelope sealed to
 * group G at one of G's older key epochs means recovering G's secret at that
 * epoch, which comes from G's OWN history via the envelope addressed to the
 * requester as a user. Only transitive recovery — reaching G through another
 * group — needs group-addressed envelopes, and that is what #1948 unblocks.
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
    const envelopesByStateHash = await listPrincipalMemberEnvelopesForStates(
      {
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
