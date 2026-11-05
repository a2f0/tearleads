import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  type HttpOperation,
} from "@tearleads/validators/operation";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { BoundedCache } from "../ApiCache";
import { bindPrototypeMethods, cachedRequest } from "../requestInternals";
import {
  containerWriterProjection,
  documentWriterProjection,
} from "../routes/writerProjections";
import type { RequestResult, RequestResultOptions } from "../types";
import type { WriterProjectionListing } from "../verifiedManifestCitations";
import { primeWriterProjectionSlot } from "../writerProjectionPrime";
import type {
  ApiClientContext,
  InFlightWriterProjectionResult,
} from "./apiClientContext";

interface ProjectionSlots<T> {
  readonly cache: BoundedCache<Promise<T | null>>;
  readonly inFlightResults: Map<string, InFlightWriterProjectionResult<T>>;
}

interface ProjectionRead<T> {
  readonly cacheKey: string;
  readonly path: string;
  readonly validator: (value: unknown) => value is T;
  readonly failureOperation: HttpOperation;
}

/**
 * Container and document writer projections: plain cached reads, coalesced
 * status-bearing reads, and primes from just-authored mutation material.
 */
export class WriterProjectionArea {
  private readonly containers: ProjectionSlots<ContainerWriterProjectionResponse>;
  private readonly documents: ProjectionSlots<DocumentWriterProjectionResponse>;

  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, WriterProjectionArea.prototype);
    this.containers = {
      cache: context.containerWriterProjectionRequestsByContainerId,
      inFlightResults:
        context.containerWriterProjectionResultsInFlightByContainerId,
    };
    this.documents = {
      cache: context.documentWriterProjectionRequestsByDocumentId,
      inFlightResults:
        context.documentWriterProjectionResultsInFlightByDocumentId,
    };
  }

  // Shared by the writer-projection result variants: coalesce concurrent
  // result callers onto one in-flight fetch, reuse a cached success, fetch a
  // result otherwise, and reconcile the cache without ever clobbering an entry
  // that changed while the fetch was in flight.
  private writerProjectionResult<T>(
    { cache, inFlightResults }: ProjectionSlots<T>,
    read: ProjectionRead<T>,
    options: RequestResultOptions,
  ): Promise<RequestResult<T>> {
    const { cacheKey, path, validator, failureOperation } = read;
    // Request-affecting options make the response caller-specific: run the
    // request directly with the caller's options, join no shared fetch, and
    // never publish the outcome to the shared caches. Only reporting-only
    // callers below participate in coalescing and cache warming.
    if (
      options.headers !== undefined ||
      options.retryOnSessionExpired !== undefined
    ) {
      return this.context.requestResult(
        path,
        validator,
        "GET",
        undefined,
        options,
        failureOperation,
      );
    }

    // A concurrent burst shares one fetch — failure included — so it cannot
    // repeat the HTTP request or the 402 billing signal. The entry lives only
    // while the fetch is in flight: failures are shared, never cached, so a
    // later retry refetches. An in-flight fetch is joinable only while the
    // value slot and per-key invalidation stamp it started against are
    // unchanged: a prime, a completed plain GET, or an eviction of THIS id
    // that lands mid-flight makes the older fetch unadoptable, so a later
    // caller reads the current cache state (or fetches fresh) instead of
    // joining a fetch that predates it — while invalidations of other ids
    // leave the coalescing intact. Eviction and priming also delete the
    // entry outright; the identity guard keeps a late settle from deleting a
    // successor's entry.
    //
    // The shared fetch itself is always silent; each caller applies its OWN
    // reporting policy to the shared outcome below. Coalescing therefore
    // never lets one caller's reportErrors suppress (or force) another's,
    // and caller options never reach the request — the fetch takes none.
    const slot = cache.get(cacheKey);
    const invalidationStamp = cache.invalidationStamp(cacheKey);
    const inFlight = inFlightResults.get(cacheKey);
    let shared: Promise<RequestResult<T>>;
    if (
      inFlight &&
      inFlight.slot === slot &&
      inFlight.invalidationStamp === invalidationStamp
    ) {
      shared = inFlight.resultPromise;
    } else {
      const entry: InFlightWriterProjectionResult<T> = {
        invalidationStamp,
        resultPromise: this.fetchWriterProjectionResult(cache, read).finally(
          () => {
            if (inFlightResults.get(cacheKey) === entry) {
              inFlightResults.delete(cacheKey);
            }
          },
        ),
        slot,
      };
      inFlightResults.set(cacheKey, entry);
      shared = entry.resultPromise;
    }

    if (options.reportErrors === false) {
      return shared;
    }
    return shared.then((result) => {
      if (!result.ok) {
        result.report();
      }
      return result;
    });
  }

  // The fetch half of writerProjectionResult. Cache reconciliation guards
  // against both mid-flight slot replacement (identity comparison) and
  // mid-flight eviction of an empty slot (the per-key invalidation stamp),
  // so a projection an eviction (e.g. after a revoke) meant to drop is never
  // re-cached.
  private async fetchWriterProjectionResult<T>(
    cache: BoundedCache<Promise<T | null>>,
    { cacheKey, path, validator, failureOperation }: ProjectionRead<T>,
  ): Promise<RequestResult<T>> {
    let cached = cache.get(cacheKey);
    while (cached) {
      try {
        const data = await cached;
        if (data) {
          return { data, ok: true };
        }
      } catch {
        // A rejected shared entry is reconciled by its own settle handler;
        // fall through either way.
      }
      // The awaited entry settled empty. Re-read the slot before fetching: a
      // newer entry installed while we awaited must be reused, not fetched
      // over — the set below would otherwise clobber it.
      const current = cache.get(cacheKey);
      if (current === cached) {
        break;
      }
      cached = current;
    }

    // The plain value cache never sees this fetch while it is in flight: a
    // published always-silent entry would hand a concurrent PLAIN caller a
    // null without its normal error reporting. Plain callers keep their own
    // fetch-and-report behavior instead, and only a success is published.
    // Always silent here: reporting is per-caller in writerProjectionResult,
    // and taking no caller options is what guarantees nothing
    // request-affecting can be smuggled into the shared fetch.
    const invalidationStamp = cache.invalidationStamp(cacheKey);
    const result = await this.context.requestResult(
      path,
      validator,
      "GET",
      undefined,
      {
        reportErrors: false,
      },
      failureOperation,
    );

    if (result.ok) {
      // Publish the success unless the slot changed or this id was
      // invalidated mid-flight. The stamp check is what makes an eviction of
      // THIS id visible even when the slot was empty before and after the
      // flight — the case the identity comparison alone cannot see — and it
      // never caches a projection an eviction meant to drop.
      if (
        cache.get(cacheKey) === cached &&
        cache.invalidationStamp(cacheKey) === invalidationStamp
      ) {
        cache.set(cacheKey, Promise.resolve(result.data));
      }
    } else if (cached && cache.get(cacheKey) === cached) {
      // The adopted entry settled empty and the fetch confirmed there is
      // nothing to serve: drop it so a later read refetches.
      cache.delete(cacheKey);
    }

    return result;
  }

  /** `listing` only picks which held bytes an unstored container cites. */
  getContainerWriterProjection(
    containerId: string,
    listing?: WriterProjectionListing,
  ) {
    return cachedRequest(this.containers.cache, containerId, () =>
      this.context.request(
        containerWriterProjection.path(containerId),
        containerWriterProjection.isResponseFor(containerId),
        containerWriterProjection.method,
        undefined,
        listing ? { projectionListing: listing } : undefined,
        getContainerWriterProjectionOperation,
      ),
    );
  }

  getContainerWriterProjectionResult(
    containerId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerWriterProjectionResponse>> {
    return this.writerProjectionResult(
      this.containers,
      {
        cacheKey: containerId,
        path: containerWriterProjection.path(containerId),
        validator: containerWriterProjection.isResponseFor(containerId),
        failureOperation: getContainerWriterProjectionOperation,
      },
      options,
    );
  }

  getDocumentWriterProjection(documentId: string) {
    return cachedRequest(this.documents.cache, documentId, () =>
      this.context.request(
        documentWriterProjection.path(documentId),
        documentWriterProjection.isResponseFor(documentId),
        documentWriterProjection.method,
        undefined,
        undefined,
        getDocumentWriterProjectionOperation,
      ),
    );
  }

  getDocumentWriterProjectionResult(
    documentId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentWriterProjectionResponse>> {
    return this.writerProjectionResult(
      this.documents,
      {
        cacheKey: documentId,
        path: documentWriterProjection.path(documentId),
        validator: documentWriterProjection.isResponseFor(documentId),
        failureOperation: getDocumentWriterProjectionOperation,
      },
      options,
    );
  }

  /**
   * Seed the writer-projection cache from a mutation response the client just
   * authored, so the next read resolves locally instead of a cold
   * `GET /documents/:documentId/writer-projection`. The seed is the same
   * material a fresh fetch returns (create/link/sync responses carry the
   * manifest, content-key bundle, and KEK targets; authorizing paths are the
   * projection the client supplied). No-op when a fetch is in flight or the
   * slot is primed — never clobber an existing entry. The existing invalidation
   * paths (sync-change, share/rekey/move, link/unlink) evict a primed
   * projection that later goes stale, exactly as they evict a fetched one.
   */
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void {
    primeWriterProjectionSlot({
      cache: this.documents.cache,
      describes: documentWriterProjection.isResponseFor(documentId),
      id: documentId,
      inFlightResults: this.documents.inFlightResults,
      label: "Document",
      projection,
    });
  }

  /**
   * Container counterpart of {@link primeDocumentWriterProjection}: seed the
   * container writer-projection cache from a create the client just authored so
   * the next write under that container (a child folder, a document) resolves
   * locally instead of a cold `GET /containers/:containerId/writer-projection`.
   * The seed is the same material a fresh fetch returns — the create plan's
   * authorizing path and container KEKs — validated by the caller against the
   * create response before priming. No-op when a fetch is in flight or the slot
   * is already primed, so it never clobbers a newer entry. The existing
   * invalidation (share/revoke/rekey/move/delete -> clearWriterProjectionCaches)
   * evicts a primed projection that later goes stale exactly as it evicts a
   * fetched one, so a subsequent write on stale access still fails closed and
   * retries with a fresh projection.
   */
  primeContainerWriterProjection(
    containerId: string,
    projection: ContainerWriterProjectionResponse,
  ): void {
    primeWriterProjectionSlot({
      cache: this.containers.cache,
      describes: containerWriterProjection.isResponseFor(containerId),
      id: containerId,
      inFlightResults: this.containers.inFlightResults,
      label: "Container",
      projection,
    });
  }
}
