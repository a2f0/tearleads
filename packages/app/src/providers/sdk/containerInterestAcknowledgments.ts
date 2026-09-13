/** Keep late responses from overwriting a newer declaration for the same ID. */
export class ContainerInterestAcknowledgments {
  private readonly pending = new Map<
    string,
    { ids: readonly string[]; generation: number }
  >();
  private readonly latestByContainer = new Map<string, string>();

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  register(
    declarationId: string,
    ids: readonly string[],
    generation: number,
  ): void {
    this.pending.set(declarationId, { ids, generation });
    for (const id of ids) this.latestByContainer.set(id, declarationId);
  }

  apply(
    declarationId: string,
    acceptedIds: readonly string[],
    declared: Set<string>,
    generation: number,
  ): { processed: boolean; retry: boolean } {
    const request = this.pending.get(declarationId);
    if (!request) return { processed: false, retry: false };
    this.pending.delete(declarationId);
    const accepted = new Set(acceptedIds);
    let refused = false;
    for (const id of request.ids) {
      if (this.latestByContainer.get(id) !== declarationId) continue;
      this.latestByContainer.delete(id);
      if (!accepted.has(id)) refused = declared.delete(id) || refused;
    }
    return {
      processed: true,
      retry: refused && generation > request.generation,
    };
  }

  invalidate(containerId?: string): void {
    if (containerId === undefined) this.latestByContainer.clear();
    else this.latestByContainer.delete(containerId);
  }

  stop(): void {
    this.pending.clear();
    this.latestByContainer.clear();
  }
}
