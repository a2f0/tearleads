import type { ContainerState } from "../../workflows/container-contents/remoteHydration";

export class ContainerStateMap extends Map<string, ContainerState> {
  readonly #mutationGenerationById = new Map<string, number>();
  #nextMutationGeneration = 0;

  constructor(entries?: ReadonlyMap<string, ContainerState>) {
    super();
    for (const [containerId, state] of entries ?? []) {
      super.set(containerId, state);
    }
  }

  override clear(): void {
    for (const containerId of this.keys()) {
      this.recordMutation(containerId);
    }
    super.clear();
  }

  override delete(containerId: string): boolean {
    const deleted = super.delete(containerId);
    // An absent delete is still an authoritative tombstone observation. A
    // local-refresh query that started before it must not install a stale row
    // merely because no in-memory value existed for Map.delete to remove.
    this.recordMutation(containerId);
    return deleted;
  }

  override set(containerId: string, state: ContainerState): this {
    this.recordMutation(containerId);
    return super.set(containerId, state);
  }

  captureMutationGenerations(): ReadonlyMap<string, number> {
    return new Map(this.#mutationGenerationById);
  }

  hasMutationAfter(
    containerId: string,
    baseline: ReadonlyMap<string, number>,
  ): boolean {
    return (
      (this.#mutationGenerationById.get(containerId) ?? 0) !==
      (baseline.get(containerId) ?? 0)
    );
  }

  private recordMutation(containerId: string): void {
    this.#nextMutationGeneration += 1;
    this.#mutationGenerationById.set(containerId, this.#nextMutationGeneration);
  }
}

export function captureContainerStateMutationGenerations(
  states: Map<string, ContainerState>,
): ReadonlyMap<string, number> {
  return states instanceof ContainerStateMap
    ? states.captureMutationGenerations()
    : new Map();
}

export function containerStateMutatedAfter(
  states: Map<string, ContainerState>,
  containerId: string,
  baseline: ReadonlyMap<string, number>,
): boolean {
  return (
    states instanceof ContainerStateMap &&
    states.hasMutationAfter(containerId, baseline)
  );
}
