import { getStoredDocumentTypeLabel } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  DEFAULT_DOCUMENT_ID,
  DocumentsProvider,
  useDocument,
} from "../../stores/documents/DocumentsProvider";
import {
  APP_DEFAULT_DOCUMENT_KIND,
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
} from "../projectors";
import {
  StructuredDocument,
  StructuredDocumentReadFields,
} from "../shared/StructuredDocument";
import type { DocumentTypeAppProps } from "../types";
import "./DefaultLoroDocument.css";

interface DefaultLoroDocumentSnapshot {
  documentKind: string;
  fields: Record<string, string>;
  text: string;
}

function formatDefaultLoroDocumentTitle(documentKind: string): string {
  const label = getStoredDocumentTypeLabel(
    documentKind,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );

  return `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`;
}

function sortedFields(
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function serializeDefaultLoroDocument(input: {
  documentKind: string;
  structuredFields: Readonly<Record<string, string>>;
  text: string;
}): DefaultLoroDocumentSnapshot {
  return {
    documentKind: input.documentKind,
    fields: sortedFields(input.structuredFields),
    text: input.text,
  };
}

function DefaultLoroDocument() {
  const { auth, state } = useTearleadsRuntime();
  const { documentKind, ready, structuredFields, syncing, text } =
    useDocument();
  const snapshot = useMemo(
    () =>
      serializeDefaultLoroDocument({
        documentKind,
        structuredFields,
        text,
      }),
    [documentKind, structuredFields, text],
  );
  const serialized = useMemo(
    () => JSON.stringify(snapshot, null, 2),
    [snapshot],
  );
  const fieldRows = useMemo(
    () => [
      { label: "Kind", value: snapshot.documentKind },
      ...Object.entries(snapshot.fields).map(([label, value]) => ({
        label,
        value,
      })),
    ],
    [snapshot],
  );

  return (
    <StructuredDocument
      fields={
        <div className="default-loro-document-fields">
          <StructuredDocumentReadFields fields={fieldRows} />
          <section className="default-loro-document-serialized">
            <strong>Serialized Data</strong>
            <pre>{serialized}</pre>
          </section>
        </div>
      }
      isAuthenticated={auth.isAuthenticated}
      online={state.online}
      ready={ready}
      syncing={syncing}
      title={formatDefaultLoroDocumentTitle(
        snapshot.documentKind || APP_DEFAULT_DOCUMENT_KIND,
      )}
    />
  );
}

export function DefaultLoroDocumentApp({
  containerId,
  documentId,
  localId = DEFAULT_DOCUMENT_ID,
}: DocumentTypeAppProps) {
  return (
    <DocumentsProvider
      localId={localId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
    >
      <DefaultLoroDocument />
    </DocumentsProvider>
  );
}
