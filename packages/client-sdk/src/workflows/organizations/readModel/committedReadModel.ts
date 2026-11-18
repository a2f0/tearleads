import { organizationReadModelCursorPosition } from "@tearleads/validators/organizationReadModelCursor";
import type { OrganizationReadModelDeltaResponse } from "@tearleads/validators/response";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { OrganizationDirectoryAndGroups } from "./index";
import {
  isOrganizationPresentationAccessReadable,
  organizationAccessScopeKey,
} from "./organizationPresentationAccessState";
import { applyOrganizationReadModelPageAt } from "./readModelProjection";

/**
 * The read-model delta one of this device's mutations carried back, and the
 * cursor it held when it sent the mutation: the page a feed read from that
 * cursor returns once the mutation committed.
 */
export interface CommittedReadModelOffer {
  readonly delta: OrganizationReadModelDeltaResponse;
  readonly heldCursor: string;
}

/** A mutation in flight: the cursors it can commit lie in (held, held + stamps]. */
interface PendingLease {
  readonly heldPosition: bigint | null;
  readonly maxStamps: number;
}

/** What applying an offer presented; `undefined` when it applied nothing. */
export type CommittedReadModelOutcome =
  | OrganizationDirectoryAndGroups
  | null
  | undefined;

interface ScopeOffers {
  /** Each claimed offer's one apply, shared by every caller that claims it. */
  readonly applying: WeakMap<
    OrganizationReadModelDeltaResponse,
    Promise<CommittedReadModelOutcome>
  >;
  readonly pending: Map<Promise<void>, PendingLease>;
  settled: readonly CommittedReadModelOffer[];
}

interface CommittedReadModelScope {
  /** The runtime's domain scope; an identity switch replaces it. */
  readonly domainScope: object;
  readonly execSql: ExecSql;
  readonly organizationId: string;
  /** The runtime's session generation; a logout or new login advances it. */
  readonly sessionGeneration: number;
  readonly userId: string;
}

/** A settled offer older than this many is dropped unread. */
const MAX_SETTLED_OFFERS = 4;
/** A hint's cursor check waits no longer than this for mutations in flight. */
const MAX_PENDING_WAIT_MS = 10_000;

// Keyed by domain scope and session generation, so a mutation and a hint
// check of one session never meet those of a session that replaced it.
const offersByDomainScope = new WeakMap<object, Map<string, ScopeOffers>>();

function scopeOffers(scope: CommittedReadModelScope): ScopeOffers {
  let byScope = offersByDomainScope.get(scope.domainScope);
  if (!byScope) {
    byScope = new Map();
    offersByDomainScope.set(scope.domainScope, byScope);
  }
  const requester = organizationAccessScopeKey(
    scope.organizationId,
    scope.userId,
  );
  const key = `${scope.sessionGeneration}:${requester}`;
  let offers = byScope.get(key);
  if (!offers) {
    // A newer session retires the requester's older buckets and their offers.
    for (const [existing] of byScope) {
      const [generation, ...rest] = existing.split(":");
      if (
        rest.join(":") === requester &&
        Number(generation) < scope.sessionGeneration
      )
        byScope.delete(existing);
    }
    offers = { applying: new WeakMap(), pending: new Map(), settled: [] };
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
  /** How many cursors the mutation can stamp; a share stamps one. */
  maxStamps = Number.POSITIVE_INFINITY,
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
  offers.pending.set(promise, {
    heldPosition: organizationReadModelCursorPosition(
      heldCursor,
      scope.organizationId,
    ),
    maxStamps,
  });
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

/** Whether a mutation in flight could be the commit a hint names. */
function couldCommit(lease: PendingLease, hintPosition: bigint): boolean {
  return (
    lease.heldPosition !== null &&
    hintPosition > lease.heldPosition &&
    (lease.maxStamps === Number.POSITIVE_INFINITY ||
      hintPosition <= lease.heldPosition + BigInt(lease.maxStamps))
  );
}

/**
 * Wait, for a bounded time, for this scope's mutations in flight that could
 * be the commit a realtime hint names, then list every unclaimed delta, oldest
 * first: a hint names a commit, and an offer at or past it reflects that
 * commit. A mutation still in flight after the wait leaves the check to read.
 */
export async function awaitCommittedReadModelOffers(
  scope: CommittedReadModelScope,
  hintPosition: bigint,
  maxWaitMs = MAX_PENDING_WAIT_MS,
): Promise<readonly CommittedReadModelOffer[]> {
  const offers = scopeOffers(scope);
  const awaited = [...offers.pending]
    .filter(([, lease]) => couldCommit(lease, hintPosition))
    .map(([promise]) => promise);
  if (awaited.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(awaited),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxWaitMs);
      }),
    ]);
    clearTimeout(timer);
  }
  return scopeOffers(scope).settled;
}

/**
 * Apply one offer once, by its delta. The first claimant (a hint's cursor
 * check or the mutation's own reconcile) runs `apply`; a later claimant of the
 * same delta shares that outcome instead of reading. `undefined` when the
 * scope holds no such offer.
 */
export function claimCommittedReadModelOffer(
  scope: CommittedReadModelScope,
  delta: OrganizationReadModelDeltaResponse,
  apply: (offer: CommittedReadModelOffer) => Promise<CommittedReadModelOutcome>,
): Promise<CommittedReadModelOutcome> | undefined {
  const offers = scopeOffers(scope);
  const claimed = offers.applying.get(delta);
  if (claimed) return claimed;
  const offer = offers.settled.find((settled) => settled.delta === delta);
  if (!offer) return undefined;
  offers.settled = offers.settled.filter((settled) => settled !== offer);
  const outcome = apply(offer);
  offers.applying.set(delta, outcome);
  return outcome;
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

/**
 * Apply the read-model delta a mutation's response carried as the page a feed
 * read from `requestedCursor` returns, with no request. Resolves `undefined`
 * when it is not applied: its cursor does not advance past the one sent, the
 * projection no longer holds that cursor, or the page applied stale. The
 * caller then reads the feed as before.
 */
export async function applyCommittedOrganizationReadModel(
  input: Parameters<typeof applyOrganizationReadModelPageAt>[0],
): Promise<OrganizationDirectoryAndGroups | null | undefined> {
  const sent = organizationReadModelCursorPosition(
    input.requestedCursor,
    input.organizationId,
  );
  const next = organizationReadModelCursorPosition(
    input.response.nextCursor,
    input.organizationId,
  );
  if (sent === null || next === null || next <= sent) return undefined;
  return applyOrganizationReadModelPageAt(input);
}
