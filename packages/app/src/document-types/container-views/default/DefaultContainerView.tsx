import { ContainerNotes } from "../shared/ContainerNotes";
import type { ContainerViewProps } from "../shared/containerViewTypes";

/** Fallback for primary documents without a specialized view: the notes. */
export function DefaultContainerView({
  containerId,
  documentQueries,
  onOpenDocument,
  revision,
}: ContainerViewProps) {
  return (
    <ContainerNotes
      containerId={containerId}
      documentQueries={documentQueries}
      revision={revision}
      onOpenDocument={onOpenDocument}
    />
  );
}
