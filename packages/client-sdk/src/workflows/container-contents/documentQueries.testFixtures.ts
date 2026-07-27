import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";

export async function saveTestContainer(input: {
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.saveContainer
  >[0];
  icon?: string | null;
  id: string;
  name: string;
  organizationId?: string | undefined;
  parentId: string | null;
  systemSlot?: string | null;
  timestamp: string;
}) {
  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      icon: input.icon ?? null,
      id: input.id,
      effectiveAccessLevel: "admin",
      metadataDocumentId: null,
      name: input.name,
      organizationId: input.organizationId ?? "org-1",
      parentId: input.parentId,
      systemSlot: input.systemSlot ?? null,
    },
    null,
    { localUpdatedAt: input.timestamp },
  );
}

export async function saveTestDocument(input: {
  containerId: string;
  documentId: string | null;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  id: string;
  kind?: "note" | "drivers_license" | "credit_card";
  title: string;
  updatedAt: string;
}) {
  await sqlDocumentsPersistence.saveDocument(
    input.execSql,
    {
      accessEpoch: 1,
      containerId: input.containerId,
      documentId: input.documentId,
      documentKind: input.kind ?? "note",
      id: input.id,
      snapshotEndVersion: "",
      text: input.title,
      title: input.title,
    },
    { updatedAt: input.updatedAt },
  );
}
