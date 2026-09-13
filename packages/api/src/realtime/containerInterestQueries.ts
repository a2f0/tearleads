import type {
  AuthorizeContainerAccess,
  VerifiedContainerInterest,
} from "./containerInterestTypes";
import { socketSessionKey, type WsConnection } from "./wsConnection";

const MAX_AUTHORIZATION_ATTEMPTS = 3;
const MAX_PENDING_ACCESS_CHANGES = 10_000;

interface ActiveQuery {
  readonly changed: Set<string>;
  overflow: boolean;
}

export class ContainerInterestQueries {
  private readonly active = new Map<string, ActiveQuery>();

  constructor(
    private readonly authorize: AuthorizeContainerAccess,
    private readonly timeoutMs: number,
  ) {}

  invalidate(containerId: string): void {
    for (const query of this.active.values()) {
      if (query.changed.size >= MAX_PENDING_ACCESS_CHANGES)
        query.overflow = true;
      else query.changed.add(containerId);
    }
  }

  async run(
    ws: WsConnection,
    ids: string[],
    isOpen: () => boolean,
    install: (proofs: VerifiedContainerInterest[]) => void,
  ): Promise<void> {
    if (ids.length === 0) {
      if (isOpen()) install([]);
      return;
    }
    const key = socketSessionKey(ws);
    for (
      let attempt = 0;
      attempt < MAX_AUTHORIZATION_ATTEMPTS && isOpen();
      attempt++
    ) {
      if (this.active.has(key))
        throw new Error("Container authorization already pending for session");
      const query: ActiveQuery = { changed: new Set(), overflow: false };
      this.active.set(key, query);
      // Finally belongs to the raw query, not the timeout race. A hung query
      // blocks another query for this session even after its socket reconnects.
      let settled = false;
      let finished = false;
      const raw = Promise.resolve()
        .then(() => this.authorize(ws.data.userId, ids))
        .finally(() => {
          settled = true;
          if (finished) this.active.delete(key);
        });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const proofs = await Promise.race([
          raw,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Container authorization timed out")),
              this.timeoutMs,
            );
          }),
        ]);
        if (query.overflow)
          throw new Error("Too many pending container access changes");
        const relevantChange = proofs.some(
          (proof) =>
            query.changed.has(proof.containerId) ||
            proof.pathContainerIds.some((id) => query.changed.has(id)),
        );
        if (!relevantChange) {
          const requested = new Set(ids);
          // Install before releasing the observation window: an access event
          // must see either this pending query or its installed dependencies.
          if (isOpen())
            install(proofs.filter((proof) => requested.has(proof.containerId)));
          return;
        }
      } finally {
        clearTimeout(timer);
        finished = true;
        if (settled) this.active.delete(key);
      }
    }
    if (isOpen())
      throw new Error(
        "Container access changed repeatedly during authorization",
      );
  }
}
