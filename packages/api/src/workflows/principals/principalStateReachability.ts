import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";

type ManagedPrincipalType = StoredPrincipalState["principalType"];

interface PrincipalReference {
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
}

function principalKey(principal: PrincipalReference): string {
  return `${principal.principalType}:${principal.principalId}`;
}

function projectionStateKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
}

function uniqueSortedStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

async function loadProjectionMembersByState(input: {
  readonly executor: DatabaseTransaction;
  readonly states: readonly StoredPrincipalState[];
}): Promise<Map<string, StoredPrincipalProjectionMember[]>> {
  const projectionByState = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const state of input.states) {
    projectionByState.set(projectionStateKey(state), []);
  }

  for (const principalType of [
    ...new Set(input.states.map((state) => state.principalType)),
  ]) {
    const statesForType = input.states.filter(
      (state) => state.principalType === principalType,
    );
    const projections = await listPrincipalProjectionMembersForStates(
      principalType,
      statesForType,
      input.executor,
    );

    for (const [stateKey, members] of projections) {
      projectionByState.set(stateKey, members);
    }
  }

  return projectionByState;
}

export async function listUserIdsReachableFromPrincipalState(input: {
  readonly executor: DatabaseTransaction;
  readonly state: StoredPrincipalState;
}): Promise<string[]> {
  const userIds = new Set<string>();
  const visitedPrincipalKeys = new Set([principalKey(input.state)]);
  let frontier: StoredPrincipalState[] = [input.state];

  while (frontier.length > 0) {
    const projectionsByState = await loadProjectionMembersByState({
      executor: input.executor,
      states: frontier,
    });
    const nextGroupIds = new Set<string>();

    for (const state of frontier) {
      for (const member of projectionsByState.get(projectionStateKey(state)) ??
        []) {
        if (member.memberPrincipalType === "user") {
          userIds.add(member.userId);
          continue;
        }

        const key = principalKey({
          principalType: "group",
          principalId: member.userId,
        });
        if (!visitedPrincipalKeys.has(key)) {
          nextGroupIds.add(member.userId);
        }
      }
    }

    const nextStates = await getCurrentPrincipalStates(
      "group",
      uniqueSortedStrings(nextGroupIds),
      input.executor,
    );
    frontier = [];
    for (const state of nextStates.values()) {
      const key = principalKey(state);
      if (visitedPrincipalKeys.has(key)) {
        continue;
      }
      visitedPrincipalKeys.add(key);
      frontier.push(state);
    }
  }

  return uniqueSortedStrings(userIds);
}
