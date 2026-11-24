import type { StoredDocumentKind } from "@tearleads/client-sdk";
import { getDocumentTypeIcon } from "../../../document-types/registry";

// Renders a document's glyph from its kind: the same mapping the item list and
// the "New Document" picker use, falling back to the generic file glyph.
export function ExplorerDocumentIcon(params: {
  className?: string;
  documentKind: StoredDocumentKind;
}) {
  const Glyph = getDocumentTypeIcon(params.documentKind);

  return (
    <Glyph
      aria-hidden="true"
      className={params.className}
      data-icon={params.documentKind}
      focusable="false"
      size={16}
      weight="regular"
    />
  );
}
