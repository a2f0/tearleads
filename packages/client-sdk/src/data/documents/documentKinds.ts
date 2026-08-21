import type { LoroList, LoroMap } from "@symcrypt/loro";
import type { ExecSql, SqlTableSchema } from "../sqlite/sqlSchema";
import {
  DEFAULT_DOCUMENT_KIND,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
} from "./documentConstants";
import { type DocumentRowSummary, listDocumentRows } from "./documentRowList";

export type StoredDocumentKind = string;

export interface DocumentFieldValidationIssue {
  field: string;
  message: string;
  value: unknown;
}

export interface ValidatedDocumentFields<TFields> {
  fields: TFields;
  issues: DocumentFieldValidationIssue[];
}

export interface StoredDocumentState {
  documentKind: StoredDocumentKind;
  fieldValidationIssues: DocumentFieldValidationIssue[];
  structuredFields: Record<string, string>;
  text: string;
  title: string;
}

export interface StructuredDocumentMap {
  delete: (key: string) => void;
  entries: () => Array<[string, unknown]>;
  get: (key: string) => unknown;
  getOrCreateContainer: (
    key: string,
    container: LoroMap<Record<string, unknown>>,
  ) => StructuredDocumentMap;
  set: (key: string, value: string | number) => void;
}

export interface StructuredDocumentText {
  toString: () => string;
}

export interface StructuredDocumentShape {
  getList: (key: string) => LoroList;
  getMap: (key: string) => StructuredDocumentMap;
  getText: (key: string) => StructuredDocumentText;
}

export interface DocumentProjectorInput {
  documentKind: StoredDocumentKind;
  structuredFields: Readonly<Record<string, unknown>>;
  text: string;
  // The document's repeated rows (variables, readings, …), so a projector can
  // derive a count-based title. Absent for kinds that carry no row list.
  rows?: ReadonlyArray<DocumentRowSummary> | undefined;
}

export interface DocumentProjection {
  fieldValidationIssues: ReadonlyArray<DocumentFieldValidationIssue>;
  structuredFields: Readonly<Record<string, string>>;
  title: string;
}

export interface DocumentClientProjectionSaveInput {
  containerId: string | null;
  documentId: string | null;
  documentKind: StoredDocumentKind;
  execSql: ExecSql;
  localId: string;
  structuredFields: Readonly<Record<string, string>>;
  text: string;
  title: string;
  updatedAt: string;
}

export interface DocumentClientProjectionDeleteInput {
  documentKind: StoredDocumentKind;
  execSql: ExecSql;
  localId: string;
}

export interface DocumentClientProjectionDefinition {
  delete?: (input: DocumentClientProjectionDeleteInput) => Promise<void> | void;
  save: (input: DocumentClientProjectionSaveInput) => Promise<void> | void;
  tables: ReadonlyArray<SqlTableSchema>;
}

export interface DocumentProjectorDefinition {
  kind: StoredDocumentKind;
  label?: string | undefined;
  schemaVersion?: number | undefined;
  untitledTitle?: string | undefined;
  clientProjection?: DocumentClientProjectionDefinition | undefined;
  initialize?: ((doc: StructuredDocumentShape) => void) | undefined;
  project?: ((input: DocumentProjectorInput) => DocumentProjection) | undefined;
}

export interface DocumentProjectorRegistry {
  getDefinition: (
    kind: StoredDocumentKind,
  ) => DocumentProjectorDefinition | undefined;
  getStoredDocumentTypeLabel: (kind: StoredDocumentKind) => string;
  getClientProjectionTables: () => ReadonlyArray<SqlTableSchema>;
  getUntitledDocumentTitle: (kind: StoredDocumentKind) => string;
  initializeStoredDocumentKind: (
    doc: StructuredDocumentShape,
    kind: StoredDocumentKind,
  ) => void;
  projectStoredDocumentState: (
    input: DocumentProjectorInput,
  ) => StoredDocumentState;
  deleteStoredDocumentClientProjection: (
    input: DocumentClientProjectionDeleteInput,
  ) => Promise<void>;
  saveStoredDocumentClientProjection: (
    input: DocumentClientProjectionSaveInput,
  ) => Promise<void>;
}

export type DocumentProjectorRegistryInput =
  | DocumentProjectorRegistry
  | ReadonlyArray<DocumentProjectorDefinition>;

const DOCUMENT_METADATA_MAP_KEY = "metadata";
export const DOCUMENT_FIELDS_MAP_KEY = "fields";
const DOCUMENT_KIND_KEY = "kind";
const DOCUMENT_SCHEMA_VERSION_KEY = "schemaVersion";
const STRUCTURED_DOCUMENT_SCHEMA_VERSION = 1;

function isStoredDocumentKind(value: unknown): value is StoredDocumentKind {
  return typeof value === "string" && value.trim().length > 0;
}

function isStructuredDocumentKind(
  value: unknown,
): value is Exclude<StoredDocumentKind, "note"> {
  return isStoredDocumentKind(value) && value !== DEFAULT_DOCUMENT_KIND;
}

function getDocumentText(doc: StructuredDocumentShape): string {
  return doc.getText("text").toString();
}

function getMetadataMap(doc: StructuredDocumentShape): StructuredDocumentMap {
  return doc.getMap(DOCUMENT_METADATA_MAP_KEY);
}

function getFieldsMap(doc: StructuredDocumentShape): StructuredDocumentMap {
  return doc.getMap(DOCUMENT_FIELDS_MAP_KEY);
}

function readDocumentKind(doc: StructuredDocumentShape): StoredDocumentKind {
  const kind = getMetadataMap(doc).get(DOCUMENT_KIND_KEY);
  return isStoredDocumentKind(kind) ? kind : DEFAULT_DOCUMENT_KIND;
}

function readStructuredFields(
  doc: StructuredDocumentShape,
): Record<string, unknown> {
  return Object.fromEntries(getFieldsMap(doc).entries());
}

function humanizeDocumentKind(kind: StoredDocumentKind): string {
  const label = kind
    .trim()
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
  return label.length > 0 ? label : "document";
}

export function readStringDocumentField(
  source: Readonly<Record<string, unknown>>,
  field: string,
  issues: DocumentFieldValidationIssue[],
): string {
  const value = source[field];
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  issues.push({
    field,
    message: "Expected a string value.",
    value,
  });
  return "";
}

function readGenericStructuredFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<Record<string, string>> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields: Record<string, string> = {};

  for (const field of Object.keys(source)) {
    fields[field] = readStringDocumentField(source, field, issues);
  }

  return { fields, issues };
}

function deriveNoteTitle(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Untitled note";
}

function projectDefaultDocumentState(
  input: DocumentProjectorInput,
  registry: DocumentProjectorRegistry,
): StoredDocumentState {
  if (input.documentKind === DEFAULT_DOCUMENT_KIND) {
    return {
      documentKind: DEFAULT_DOCUMENT_KIND,
      fieldValidationIssues: [],
      structuredFields: {},
      text: input.text,
      title: deriveNoteTitle(input.text),
    };
  }

  const validated = readGenericStructuredFieldsFromRecord(
    input.structuredFields,
  );
  return {
    documentKind: input.documentKind,
    fieldValidationIssues: validated.issues,
    structuredFields: { ...validated.fields },
    text: input.text,
    title: registry.getUntitledDocumentTitle(input.documentKind),
  };
}

function createStoredDocumentState(
  input: DocumentProjectorInput,
  projection: DocumentProjection,
): StoredDocumentState {
  return {
    documentKind: input.documentKind,
    fieldValidationIssues: [...projection.fieldValidationIssues],
    structuredFields: { ...projection.structuredFields },
    text: input.text,
    title: projection.title,
  };
}

export function createDocumentProjectorRegistry(
  definitions: ReadonlyArray<DocumentProjectorDefinition> = [],
): DocumentProjectorRegistry {
  const definitionsByKind = new Map<
    StoredDocumentKind,
    DocumentProjectorDefinition
  >();
  for (const definition of definitions) {
    if (!isStoredDocumentKind(definition.kind)) {
      throw new Error(
        "Document projector definitions require a non-empty kind.",
      );
    }

    definitionsByKind.set(definition.kind, definition);
  }

  const registry: DocumentProjectorRegistry = {
    getDefinition(kind) {
      return definitionsByKind.get(kind);
    },
    getClientProjectionTables() {
      return definitions.flatMap(
        (definition) => definition.clientProjection?.tables ?? [],
      );
    },
    getStoredDocumentTypeLabel(kind) {
      return definitionsByKind.get(kind)?.label ?? humanizeDocumentKind(kind);
    },
    getUntitledDocumentTitle(kind) {
      const definition = definitionsByKind.get(kind);
      if (definition?.untitledTitle) {
        return definition.untitledTitle;
      }

      if (kind === DEFAULT_DOCUMENT_KIND) {
        return "Untitled note";
      }

      // The SDK provisions this kind itself, so hosts that never register a
      // projector for it still get its stable title instead of the
      // humanized generic form.
      if (kind === ORGANIZATION_PROFILE_DOCUMENT_KIND) {
        return "Organization Profile";
      }

      return `Untitled ${registry.getStoredDocumentTypeLabel(kind)}`;
    },
    initializeStoredDocumentKind(doc, kind) {
      if (!isStructuredDocumentKind(kind)) {
        return;
      }

      const metadata = getMetadataMap(doc);
      const definition = definitionsByKind.get(kind);
      metadata.set(DOCUMENT_KIND_KEY, kind);
      metadata.set(
        DOCUMENT_SCHEMA_VERSION_KEY,
        definition?.schemaVersion ?? STRUCTURED_DOCUMENT_SCHEMA_VERSION,
      );
      getFieldsMap(doc);
      definition?.initialize?.(doc);
    },
    projectStoredDocumentState(input) {
      const definition = definitionsByKind.get(input.documentKind);
      if (definition?.project) {
        return createStoredDocumentState(input, definition.project(input));
      }

      return projectDefaultDocumentState(input, registry);
    },
    async deleteStoredDocumentClientProjection(input) {
      await definitionsByKind
        .get(input.documentKind)
        ?.clientProjection?.delete?.(input);
    },
    async saveStoredDocumentClientProjection(input) {
      await definitionsByKind
        .get(input.documentKind)
        ?.clientProjection?.save(input);
    },
  };

  return registry;
}

export const defaultDocumentProjectorRegistry =
  createDocumentProjectorRegistry();

const documentProjectorRegistryCache = new WeakMap<
  ReadonlyArray<DocumentProjectorDefinition>,
  DocumentProjectorRegistry
>();

function isDocumentProjectorRegistry(
  input: DocumentProjectorRegistryInput,
): input is DocumentProjectorRegistry {
  return (
    "getClientProjectionTables" in input &&
    typeof input.getClientProjectionTables === "function"
  );
}

export function resolveDocumentProjectorRegistry(
  input: DocumentProjectorRegistryInput | null | undefined,
): DocumentProjectorRegistry {
  if (input == null) {
    return defaultDocumentProjectorRegistry;
  }

  if (isDocumentProjectorRegistry(input)) {
    return input;
  }

  const cached = documentProjectorRegistryCache.get(input);
  if (cached) {
    return cached;
  }

  const registry = createDocumentProjectorRegistry(input);
  documentProjectorRegistryCache.set(input, registry);
  return registry;
}

export function getDocumentClientProjectionTables(
  registry:
    | DocumentProjectorRegistryInput
    | undefined = defaultDocumentProjectorRegistry,
): ReadonlyArray<SqlTableSchema> {
  return resolveDocumentProjectorRegistry(registry).getClientProjectionTables();
}

export function getUntitledDocumentTitle(
  kind: StoredDocumentKind,
  registry: DocumentProjectorRegistryInput = defaultDocumentProjectorRegistry,
): string {
  return resolveDocumentProjectorRegistry(registry).getUntitledDocumentTitle(
    kind,
  );
}

export function getStoredDocumentTypeLabel(
  kind: StoredDocumentKind,
  registry: DocumentProjectorRegistryInput = defaultDocumentProjectorRegistry,
): string {
  return resolveDocumentProjectorRegistry(registry).getStoredDocumentTypeLabel(
    kind,
  );
}

export function deriveStoredDocumentTitle(text: string): string {
  return deriveNoteTitle(text);
}

export function projectStoredDocumentState(
  input: DocumentProjectorInput,
  registry: DocumentProjectorRegistryInput = defaultDocumentProjectorRegistry,
): StoredDocumentState {
  return resolveDocumentProjectorRegistry(registry).projectStoredDocumentState(
    input,
  );
}

export function readStoredDocumentState(
  doc: StructuredDocumentShape,
  registry: DocumentProjectorRegistryInput = defaultDocumentProjectorRegistry,
): StoredDocumentState {
  const resolvedRegistry = resolveDocumentProjectorRegistry(registry);
  const documentKind = readDocumentKind(doc);
  const text = getDocumentText(doc);
  const structuredFields = isStructuredDocumentKind(documentKind)
    ? readStructuredFields(doc)
    : {};
  const rows = isStructuredDocumentKind(documentKind)
    ? listDocumentRows(doc).map((row) => ({ id: row.id, fields: row.fields }))
    : [];

  return resolvedRegistry.projectStoredDocumentState({
    documentKind,
    structuredFields,
    text,
    rows,
  });
}

export function initializeStoredDocumentKind(
  doc: StructuredDocumentShape,
  kind: StoredDocumentKind,
  registry: DocumentProjectorRegistryInput = defaultDocumentProjectorRegistry,
): void {
  resolveDocumentProjectorRegistry(registry).initializeStoredDocumentKind(
    doc,
    kind,
  );
}

export function writeStoredDocumentFields(
  doc: StructuredDocumentShape,
  kind: Exclude<StoredDocumentKind, "note">,
  patch: Readonly<Record<string, string | number | undefined>>,
  registry: DocumentProjectorRegistryInput = defaultDocumentProjectorRegistry,
): void {
  resolveDocumentProjectorRegistry(registry).initializeStoredDocumentKind(
    doc,
    kind,
  );
  const fields = getFieldsMap(doc);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      fields.delete(key);
      continue;
    }

    fields.set(key, value);
  }
}
