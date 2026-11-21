import type { DocumentStoreState } from "../state";

interface ReplacedBindingSighting {
  readonly bindingId: string;
  readonly documentId: string;
  readonly pass: number;
}

interface DetachPassSightings {
  pass: number;
  readonly bySlotId: Map<string, ReplacedBindingSighting>;
}

/**
 * Bindings of another blob a detach pass listed for a still-removed slot,
 * per store. Every pass follows a pull, so a binding sighted in an earlier
 * pass outlived a pull that would have brought the content update of a
 * re-add bound before it. Memory only: after a restart a binding needs two
 * sightings again, which only delays its detach.
 */
const sightingsByState = new WeakMap<DocumentStoreState, DetachPassSightings>();

/** Open a detach pass and read the sightings it can rely on. */
export function beginDetachPassSightings(
  state: DocumentStoreState,
  documentId: string,
) {
  const sightings = sightingsByState.get(state) ?? {
    bySlotId: new Map<string, ReplacedBindingSighting>(),
    pass: 0,
  };
  sightings.pass += 1;
  sightingsByState.set(state, sightings);
  const { pass } = sightings;
  return {
    /** The binding id sighted for `slotId` in an earlier pass, if any. */
    confirmed(slotId: string): string | undefined {
      const sighting = sightings.bySlotId.get(slotId);
      return sighting &&
        sighting.documentId === documentId &&
        sighting.pass < pass
        ? sighting.bindingId
        : undefined;
    },
    /** Remember a replaced binding, keeping the earliest sighting of it. */
    sight(slotId: string, bindingId: string): void {
      const sighting = sightings.bySlotId.get(slotId);
      if (
        sighting?.bindingId === bindingId &&
        sighting.documentId === documentId
      )
        return;
      sightings.bySlotId.set(slotId, { bindingId, documentId, pass });
    },
    forget(slotId: string): void {
      sightings.bySlotId.delete(slotId);
    },
  };
}
