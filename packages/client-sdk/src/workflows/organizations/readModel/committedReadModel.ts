import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  isOrganizationPresentationAccessReadable,
  organizationAccessScopeKey,
} from "./organizationPresentationAccessState";

/**
 * The read-model delta one of this device's mutations carried back, and the
 * cursor it held when it sent the mutation: the page a feed read from that
 * cursor returns once the mutation committed.
 */
export interface CommittedReadModelOffer {
  readonly delta: OrganizationReadModelDeltaResponse;
  readonly heldCursor: string;
}

interface ScopeOffers {
  readonly pending: Set<Promise<void>>;
  settled: readonly CommittedReadModelOffer[];
}

interface CommittedReadModelScope {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly userId: string;
}

/** A settled offer older than this many is dropped unread. */
const MAX_SETTLED_OFFERS = 4;
/** A hint's cursor check waits no longer than this for mutations in flight. */
const MAX_PENDING_WAIT_MS = 10_000;

const offersByDatabase = new WeakMap<ExecSql, Map<string, ScopeOffers>>();

function scopeOffers(scope: CommittedReadModelScope): ScopeOffers {
  let byScope = offersByDatabase.get(scope.execSql);
  if (!byScope) {
    byScope = new Map();
    offersByDatabase.set(scope.execSql, byScope);
  }
  const key = organizationAccessScopeKey(scope.organizationId, scope.userId);
  let offers = byScope.get(key);
  if (!offers) {
    offers = { pending: new Set(), settled: [] };
    byScope.set(key, offers);
  }
  return offers;
}

/** A mutation that sent a held cursor; settle it once, when it ends. */
export interface CommittedReadModelLease {
  readonly heldCursor: string | undefined;
  settle(delta: OrganizationReadModelDeltaResponse | undefined): void;
}

/**
 * Begin a mutation that sends the read-model cursor this requester's next
 * reconcile would request from, so its response can carry the delta from it.
 * Until it settles, a realtime hint's cursor check waits for it. No cursor is
 * held while the requester's presentation is denied, since that reconcile
 * requests a snapshot, or when the projection cannot be read.
 */
export async function beginCommittedReadModel(
  scope: CommittedReadModelScope,
): Promise<CommittedReadModelLease> {
  // An unreadable cursor only forgoes the delta; the mutation still goes out.
  const heldCursor = await loadHeldOrganizationReadModelCursor(scope).catch(
    () => undefined,
  );
  if (heldCursor === undefined) {
    return { heldCursor, settle: () => {} };
  }
  const offers = scopeOffers(scope);
  let resolve = () => {};
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  offers.pending.add(promise);
  return {
    heldCursor,
    settle: (delta) => {
      if (!offers.pending.delete(promise)) return;
      if (delta) {
        offers.settled = [...offers.settled, { delta, heldCursor }].slice(
          -MAX_SETTLED_OFFERS,
        );
      }
      resolve();
    },
  };
}

/**
 * Wait, for a bounded time, for this scope's mutations in flight, then take
 * every delta they carried, oldest first. Only a realtime hint's cursor check
 * takes them: a hint names a commit, and an offer at or past it reflects that
 * commit. A mutation still in flight after the wait leaves the check to read.
 */
export async function takeCommittedReadModelOffers(
  scope: CommittedReadModelScope,
  maxWaitMs = MAX_PENDING_WAIT_MS,
): Promise<readonly CommittedReadModelOffer[]> {
  const offers = scopeOffers(scope);
  if (offers.pending.size > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(offers.pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxWaitMs);
      }),
    ]);
    clearTimeout(timer);
  }
  const taken = offers.settled;
  offers.settled = [];
  return taken;
}

/** Take the offer one mutation's own response carried, by its delta. */
export function takeCommittedReadModelOffer(
  scope: CommittedReadModelScope,
  delta: OrganizationReadModelDeltaResponse,
): CommittedReadModelOffer | undefined {
  const offers = scopeOffers(scope);
  const offer = offers.settled.find((settled) => settled.delta === delta);
  if (offer) {
    offers.settled = offers.settled.filter((settled) => settled !== offer);
  }
  return offer;
}

/** The projection cursor a reconcile of this requester would request from. */
export async function loadHeldOrganizationReadModelCursor(
  scope: CommittedReadModelScope,
): Promise<string | undefined> {
  if (
    !isOrganizationPresentationAccessReadable(
      { ...scope, requesterUserId: scope.userId },
      "readModel",
    )
  ) {
    return undefined;
  }
  return (
    (await new OrganizationReadModelRepository(
      scope.execSql,
    ).loadOrganizationReadModelCursor(scope.organizationId)) ?? undefined
  );
}
