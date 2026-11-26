import { isDocumentUpdateCreatedEvent } from "../../data/documents/documentSync";
import type { DomainScope } from "../../data/shared/domainScope";

/**
 * What vouches for a scope's documents between probes: container lanes that
 * the catch-up after every acknowledged connection lists when they moved,
 * where a listed document the device's processed cursor does not cover is
 * owed a read. The composition root installs it for a scope that runs such
 * listings.
 */
export interface DocumentListingAuthority {
  /**
   * Whether the catch-up's listings vouch for this container's documents: it
   * lists the lane when the lane moved, and the lane shows them.
   */
  readonly listsContainer: (containerId: string) => boolean;
}

/**
 * Whether a scope's listings cover a document, so its store need not probe
 * it on load or reconnect. One per domain scope; see
 * `getOrCreateDocumentListingCoverage`.
 */
export interface DocumentListingCoverage {
  /**
   * Whether a listing authority lists this container's lane and its last
   * listing attempt succeeded. False with no authority installed, which
   * leaves every store probing on its own.
   */
  coversContainer(containerId: string | null | undefined): boolean;
  /** Installs the scope's authority; the returned function removes it. */
  install(authority: DocumentListingAuthority): () => void;
  /** Records the outcome of one listing attempt of a container's lane. */
  reportLaneListed(containerId: string, listed: boolean): void;
  /**
   * Remembers which documents the update hints in `events` name. A store
   * reads hints only once its record has loaded, so one that is not open yet,
   * or is still loading, never sees a hint sent meanwhile, and the host may
   * not route it to a listing. `events` is the runtime's append-only list.
   */
  observeEvents(events: ReadonlyArray<unknown>): void;
  /**
   * Whether a hint has named the document since its store last asked; a
   * store asks when its record loads, and probes if so. Forgets the hint.
   */
  takeHint(documentId: string): boolean;
}

function createDocumentListingCoverage(): DocumentListingCoverage {
  let authority: DocumentListingAuthority | null = null;
  let observedEventCount = 0;
  const unlistedContainerIds = new Set<string>();
  const hintedDocumentIds = new Set<string>();

  return {
    coversContainer: (containerId) =>
      authority !== null &&
      typeof containerId === "string" &&
      !unlistedContainerIds.has(containerId) &&
      authority.listsContainer(containerId),
    install: (next) => {
      authority = next;
      return () => {
        if (authority !== next) return;
        authority = null;
        // What a stopped authority learned says nothing about the next one.
        unlistedContainerIds.clear();
        hintedDocumentIds.clear();
      };
    },
    reportLaneListed: (containerId, listed) => {
      if (listed) unlistedContainerIds.delete(containerId);
      else unlistedContainerIds.add(containerId);
    },
    observeEvents: (events) => {
      const unseen = events.slice(observedEventCount);
      // Stores observe on their own schedule, and one that still holds an
      // older runtime hands in a shorter prefix of the same list. Counting
      // back would replay hints a store has already taken.
      observedEventCount = Math.max(observedEventCount, events.length);
      if (authority === null) return;
      for (const event of unseen) {
        if (isDocumentUpdateCreatedEvent(event)) {
          hintedDocumentIds.add(event.documentId);
        }
      }
    },
    takeHint: (documentId) => hintedDocumentIds.delete(documentId),
  };
}

const coverageByScope = new WeakMap<DomainScope, DocumentListingCoverage>();

/** The scope's listing coverage, created on first use. */
export function getOrCreateDocumentListingCoverage(
  domainScope: DomainScope,
): DocumentListingCoverage {
  const existing = coverageByScope.get(domainScope);
  if (existing) return existing;
  const created = createDocumentListingCoverage();
  coverageByScope.set(domainScope, created);
  return created;
}
