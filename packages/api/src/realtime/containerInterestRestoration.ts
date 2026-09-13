import type { VerifiedContainerInterest } from "./containerInterestTypes";
import type { WsConnection } from "./wsConnection";

interface RestoredInterest {
  readonly idsKey: string;
  readonly keys: readonly string[];
  readonly proofs: VerifiedContainerInterest[];
  readonly expiresAt: number;
}

/** One-time reconnect proof handoff, indexed only by its actual dependencies. */
export class ContainerInterestRestoration {
  private readonly entries = new Map<WsConnection, RestoredInterest>();
  private readonly byDependency = new Map<string, Set<WsConnection>>();

  put(
    ws: WsConnection,
    ids: readonly string[],
    proofs: VerifiedContainerInterest[],
    expiresAt: number,
  ): void {
    this.clear(ws);
    const keys = [
      ...new Set([
        ...ids,
        ...proofs.flatMap((proof) => [
          proof.containerId,
          ...proof.pathContainerIds,
          ...proof.principalKeys,
        ]),
      ]),
    ];
    this.entries.set(ws, {
      idsKey: JSON.stringify([...new Set(ids)].sort()),
      keys,
      proofs,
      expiresAt,
    });
    for (const key of keys) {
      const sockets = this.byDependency.get(key) ?? new Set<WsConnection>();
      sockets.add(ws);
      this.byDependency.set(key, sockets);
    }
  }

  take(
    ws: WsConnection,
    ids: readonly string[] | null,
  ): VerifiedContainerInterest[] | null {
    const entry = this.entries.get(ws);
    this.clear(ws);
    return entry &&
      ids &&
      Date.now() < entry.expiresAt &&
      entry.idsKey === JSON.stringify([...new Set(ids)].sort())
      ? entry.proofs
      : null;
  }

  invalidate(dependency: string): void {
    for (const ws of [...(this.byDependency.get(dependency) ?? [])])
      this.clear(ws);
  }

  clear(ws: WsConnection): void {
    const entry = this.entries.get(ws);
    if (!entry) return;
    this.entries.delete(ws);
    for (const key of entry.keys) {
      const sockets = this.byDependency.get(key);
      sockets?.delete(ws);
      if (sockets?.size === 0) this.byDependency.delete(key);
    }
  }
}
