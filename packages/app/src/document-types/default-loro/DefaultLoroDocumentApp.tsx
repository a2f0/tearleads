import { useMemo } from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import {
  StructuredDocument,
  StructuredDocumentReadFields,
} from "../shared/StructuredDocument";
import "./DefaultLoroDocument.css";

interface DefaultLoroDocumentSnapshot {
  documentKind: string;
  fields: Record<string, string>;
  text: string;
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
  const { documentKind, structuredFields, text } = useDocument();
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
    />
  );
}

export const DefaultLoroDocumentApp = createDocumentTypeApp(
  undefined,
  DefaultLoroDocument,
);
