import {
  type HeldContainerBinding,
  rebindsHeldContainer,
} from "../../../data/containers/containerBinding";
import { installContainerMetadataRecord } from "../metadataStateInstallation";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationState,
} from "./types";

/**
 * Apply a verified re-home of a held folder, one its own user re-created under
 * another organization or metadata target, before hydration updates or inserts
 * it. Destination verification refused every other signer. Returns false when
 * the held binding changed underneath, leaving the listing unapplied.
 */
export async function rebindReHomedContainer(input: {
  existingState: ContainerState | undefined;
  heldBinding: HeldContainerBinding | null;
  isCurrent?: (() => boolean) | undefined;
  state: RemoteContainerHydrationState;
  verified: RemoteContainer;
}): Promise<boolean> {
  const { existingState, heldBinding, state, verified } = input;
  if (!heldBinding || !rebindsHeldContainer(heldBinding, verified)) return true;
  const execSql = state.runtime.infra.execSql;
  const rebound = await state.persistence.rebindHeldContainer(execSql, {
    containerId: verified.id,
    expected: heldBinding,
    next: {
      metadataDocumentId: verified.metadataDocumentId,
      organizationId: verified.organizationId,
    },
    stillCurrent: input.isCurrent,
  });
  if (!rebound || input.isCurrent?.() === false) return false;
  if (!existingState) return true;
  const stored = await state.persistence.loadContainerMetadataState(
    execSql,
    verified.id,
  );
  if (!stored?.record || input.isCurrent?.() === false) return false;
  existingState.container = stored.container;
  existingState.containerWriterProjection = null;
  existingState.metadataWriterProjection = null;
  installContainerMetadataRecord(existingState, stored.record);
  return true;
}
