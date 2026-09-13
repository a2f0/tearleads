import type { VerifiedContainerInterest } from "./containerInterestTypes";
import type { WsConnection } from "./wsConnection";

/** Reverse index of the signed paths used to authorize each subscription. */
export class ContainerInterestDependencies {
  private readonly byAncestor = new Map<
    string,
    Map<WsConnection, Set<string>>
  >();
  private readonly bySocket = new Map<
    WsConnection,
    Map<string, readonly string[]>
  >();

  set(ws: WsConnection, proof: VerifiedContainerInterest): void {
    this.remove(ws, proof.containerId);
    const path = [
      ...new Set([
        proof.containerId,
        ...proof.pathContainerIds,
        ...proof.principalKeys,
      ]),
    ];
    const interests = this.bySocket.get(ws) ?? new Map();
    interests.set(proof.containerId, path);
    this.bySocket.set(ws, interests);
    for (const ancestor of path) {
      const sockets = this.byAncestor.get(ancestor) ?? new Map();
      const ids = sockets.get(ws) ?? new Set();
      ids.add(proof.containerId);
      sockets.set(ws, ids);
      this.byAncestor.set(ancestor, sockets);
    }
  }

  remove(ws: WsConnection, containerId: string): void {
    const interests = this.bySocket.get(ws);
    for (const ancestor of interests?.get(containerId) ?? []) {
      const sockets = this.byAncestor.get(ancestor);
      const ids = sockets?.get(ws);
      ids?.delete(containerId);
      if (ids?.size === 0) sockets?.delete(ws);
      if (sockets?.size === 0) this.byAncestor.delete(ancestor);
    }
    interests?.delete(containerId);
    if (interests?.size === 0) this.bySocket.delete(ws);
  }

  clear(ws: WsConnection): void {
    for (const id of [...(this.bySocket.get(ws)?.keys() ?? [])])
      this.remove(ws, id);
  }

  affected(ancestor: string): Array<{ ws: WsConnection; containerId: string }> {
    return [...(this.byAncestor.get(ancestor) ?? [])].flatMap(([ws, ids]) =>
      [...ids].map((containerId) => ({ ws, containerId })),
    );
  }
}
