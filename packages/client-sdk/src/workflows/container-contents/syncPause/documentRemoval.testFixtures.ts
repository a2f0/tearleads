import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createDocumentProjectorRegistry } from "../../../data/documents";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { saveTestSyncedContainer } from "../documentQueries/documentQueries.testFixtures";
import { listPendingWrites } from "../pendingWrites";
import { removeOrganizationContentUnlessPending } from "./documentRemoval";

export const UPDATED_AT = "2026-01-01T00:00:00.000Z";

export async function placedDocument(
  execSql: ExecSql,
  input: {
    containerId?: string;
    localId: string;
    pendingBaseVersion?: string;
    snapshotEndVersion: string;
  },
): Promise<void> {
  const documentId = `${input.localId}-remote`;
  const containerId = input.containerId ?? "folder";
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId,
      documentId,
      documentKind: "note",
      id: input.localId,
      ...(input.pendingBaseVersion === undefined
        ? {}
        : { pendingBaseVersion: input.pendingBaseVersion }),
      snapshotEndVersion: input.snapshotEndVersion,
      text: "",
      title: input.localId,
    },
    { updatedAt: UPDATED_AT },
  );
  await execSql(
    "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES (?, ?, ?)",
    [documentId, containerId, UPDATED_AT],
  );
}

/** Fails any statement binding more values than SQLite's default limit. */
export function bindBudgetedExecSql(execSql: ExecSql): ExecSql & {
  readonly maxBinds: () => number;
} {
  let maxBinds = 0;
  const bounded = new Proxy(execSql, {
    apply(target, thisArg, args) {
      const bind = args[1];
      const binds = Array.isArray(bind)
        ? bind.length
        : bind && typeof bind === "object"
          ? Object.keys(bind).length
          : 0;
      maxBinds = Math.max(maxBinds, binds);
      if (binds > 999) throw new Error(`SQLite bind limit exceeded: ${binds}`);
      return Reflect.apply(target, thisArg, args);
    },
  });
  return Object.assign(bounded, { maxBinds: () => maxBinds });
}

/**
 * Saves the paused organization's folder and returns two version vectors of
 * one document: the uploaded one and a later edit.
 */
export async function preparePausedFolder(
  execSql: ExecSql,
): Promise<readonly [string, string]> {
  await listPendingWrites(execSql);
  await saveTestSyncedContainer({
    execSql,
    id: "folder",
    name: "Folder",
    organizationId: "org-paused",
    timestamp: UPDATED_AT,
  });
  const document = await createDocument("sync-pause-removal");
  document.getText("text").update("first");
  document.commit();
  const first = encodeVersionVector(document);
  document.getText("text").update("second");
  document.commit();
  return [first, encodeVersionVector(document)];
}

export function removeWithRealDeletion(
  execSql: ExecSql,
  containerIds: readonly string[],
  hasQueuedWrites: (localId: string) => boolean = () => false,
  session: {
    readonly restoreDocument?: (localId: string) => void;
    readonly retireDocument?: (localId: string) => void;
    readonly stillCurrent?: () => boolean;
  } = {},
) {
  return removeOrganizationContentUnlessPending({
    containerIds,
    deleteContainers: (lockedExecSql, removals) =>
      sqlContainerContentsPersistence.deleteContainers(lockedExecSql, removals),
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql,
    hasQueuedWrites,
    organizationId: "org-paused",
    restoreDocument: session.restoreDocument ?? (() => undefined),
    retireDocument: session.retireDocument ?? (() => undefined),
    stillCurrent: session.stillCurrent ?? (() => true),
  });
}
