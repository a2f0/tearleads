import type { DocumentStoreState } from "../state";

interface ReplacedBindingSighting {
  readonly bindingId: string;
  readonly documentId: string;
  /** Pulls this store had completed when the binding was first listed. */
  readonly pulls: number;
}

interface StoreSightings {
  pulls: number;
  readonly bySlotId: Map<string, ReplacedBindingSighting>;
}

/**
 * Bindings of another blob a detach pass listed for a still-removed slot, and
 * the pulls this store has completed, per store. A binding first listed
 * before a pull that has since completed outlived the content update of a
 * re-add bound before it, which its device pushes in the same sync pass.
 * Memory only: after a restart a binding needs a fresh sighting and pull,
 * which only delays its detach.
 */
const sightingsByState = new WeakMap<DocumentStoreState, StoreSightings>();

function storeSightings(state: DocumentStoreState): StoreSightings {
  let sightings = sightingsByState.get(state);
  if (!sightings) {
    sightings = { bySlotId: new Map(), pulls: 0 };
    sightingsByState.set(state, sightings);
  }
  return sightings;
}

/** A pull for this store's current generation completed. */
export function noteDocumentPullCompleted(state: DocumentStoreState): void {
  storeSightings(state).pulls += 1;
}

/** The sightings a detach pass of `documentId` can rely on. */
export function readReplacedBindingSightings(
  state: DocumentStoreState,
  documentId: string,
) {
  const sightings = storeSightings(state);
  const current = (slotId: string) => {
    const sighting = sightings.bySlotId.get(slotId);
    return sighting?.documentId === documentId ? sighting : undefined;
  };
  return {
    /** The binding sighted for `slotId` before a pull that has completed. */
    confirmed(slotId: string): string | undefined {
      const sighting = current(slotId);
      return sighting && sighting.pulls < sightings.pulls
        ? sighting.bindingId
        : undefined;
    },
    /**
     * Remember a replaced binding, keeping the earliest sighting of it. True
     * when the sighting is new, so the caller can ask for a pull.
     */
    sight(slotId: string, bindingId: string): boolean {
      if (current(slotId)?.bindingId === bindingId) return false;
      sightings.bySlotId.set(slotId, {
        bindingId,
        documentId,
        pulls: sightings.pulls,
      });
      return true;
    },
    forget(slotId: string): void {
      sightings.bySlotId.delete(slotId);
    },
  };
}
