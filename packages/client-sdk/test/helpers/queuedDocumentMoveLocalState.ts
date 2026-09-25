import { createTestContainerState } from "../../src/workflows/container-contents/container-state/containerState.testFixtures";

export function queuedDocumentMoveLocalState(input: {
  projections: readonly { containerId: string }[];
  rootId: string;
  absentIds: readonly string[] | undefined;
}) {
  return new Map(
    input.projections
      .filter(({ containerId }) => !input.absentIds?.includes(containerId))
      .map(({ containerId }) => [
        containerId,
        createTestContainerState({
          id: containerId,
          parentId: containerId === input.rootId ? null : input.rootId,
        }),
      ]),
  );
}
