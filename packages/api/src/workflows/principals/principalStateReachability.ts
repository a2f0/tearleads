import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";

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
  // The state's own projection IS the reachable user set. This used to walk a
  // frontier of nested group states; principals contain only users now, so the
  // frontier never had a second level to visit.
  const projectionsByState = await loadProjectionMembersByState({
    executor: input.executor,
    states: [input.state],
  });
  const members = projectionsByState.get(projectionStateKey(input.state)) ?? [];

  return uniqueSortedStrings(members.map((member) => member.userId));
}
