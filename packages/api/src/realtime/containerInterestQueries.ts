import type {
  AuthorizeContainerAccess,
  VerifiedContainerInterest,
} from "./containerInterestTypes";
import { socketSessionKey, type WsConnection } from "./wsConnection";

const MAX_AUTHORIZATION_ATTEMPTS = 3;
const MAX_PENDING_ACCESS_CHANGES = 10_000;

interface ActiveQuery {
  readonly changed: Set<string>;
  readonly idsKey: string;
  readonly result: Promise<VerifiedContainerInterest[]>;
  readonly finished: Promise<void>;
  readonly finish: () => void;
  overflow: boolean;
  settled: boolean;
  stale: boolean;
  readers: number;
}

async function beforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<T> {
  if (Date.now() >= deadline)
    throw new Error("Container authorization timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Container authorization timed out")),
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function authorizationWasInvalidated(
  query: ActiveQuery,
  allowed: readonly VerifiedContainerInterest[],
  requestedIds: readonly string[],
): boolean {
  // A denied request has no verified dependency path. Retry only a change
  // to that requested ID; unrelated tenants must not delay its acknowledgment.
  // A later grant notification triggers the client's discovery/redeclaration.
  return (
    requestedIds.some((id) => query.changed.has(id)) ||
    allowed.some(
      (proof) =>
        query.changed.has(proof.containerId) ||
        [...proof.pathContainerIds, ...proof.principalKeys].some((id) =>
          query.changed.has(id),
        ),
    )
  );
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
    const idsKey = JSON.stringify([...ids].sort());
    const deadline = Date.now() + this.timeoutMs;
    let attempts = 0;
    while (isOpen() && attempts < MAX_AUTHORIZATION_ATTEMPTS) {
      if (Date.now() >= deadline)
        throw new Error("Container authorization timed out");
      const active = this.active.get(key);
      if (active && (active.idsKey !== idsKey || active.stale)) {
        // Different tabs may declare different trees. Wait within the same
        // deadline instead of rejecting an otherwise healthy shared session.
        await beforeDeadline(active.finished, deadline);
        continue;
      }
      const query = active ?? this.start(ws, ids, idsKey);
      query.readers++;
      attempts++;
      try {
        const proofs = await beforeDeadline(query.result, deadline);
        if (query.overflow)
          throw new Error("Too many pending container access changes");
        const requested = new Set(ids);
        const allowed = proofs.filter((proof) =>
          requested.has(proof.containerId),
        );
        if (authorizationWasInvalidated(query, allowed, ids)) {
          query.stale = true;
          continue;
        }
        // Keep the query observable until synchronous installation. Every
        // access event sees either this query or its installed dependencies.
        if (isOpen()) install(allowed);
        return;
      } finally {
        query.readers--;
        this.release(key, query);
      }
    }
    if (isOpen())
      throw new Error(
        "Container access changed repeatedly during authorization",
      );
  }

  private start(ws: WsConnection, ids: string[], idsKey: string): ActiveQuery {
    const key = socketSessionKey(ws);
    const completion = Promise.withResolvers<void>();
    const query: ActiveQuery = {
      changed: new Set(),
      idsKey,
      overflow: false,
      readers: 0,
      settled: false,
      stale: false,
      finished: completion.promise,
      finish: completion.resolve,
      result: Promise.resolve()
        .then(() => this.authorize(ws.data.userId, ids))
        .finally(() => {
          query.settled = true;
          this.release(key, query);
        }),
    };
    this.active.set(key, query);
    return query;
  }

  private release(key: string, query: ActiveQuery): void {
    // A socket timeout never frees the raw query slot. Reconnects share or
    // await that query until it actually settles, preventing SQL amplification.
    if (!query.settled || query.readers > 0) return;
    if (this.active.get(key) === query) this.active.delete(key);
    query.finish();
  }
}
