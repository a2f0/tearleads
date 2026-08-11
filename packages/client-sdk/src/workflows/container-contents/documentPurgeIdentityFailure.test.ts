import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentsPersistence } from "../documents";
import { purgeRemoteContainerDocument } from "./documentLinks";

test("remote document purge propagates identity failures without deleting local state", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted session identity changed",
  );
  const execSql: ExecSql = async () => [];
  const logs: string[] = [];
  let localDeletes = 0;
  const persistence = {
    deleteDocument: async () => {
      localDeletes += 1;
    },
  } as unknown as DocumentsPersistence;

  await expect(
    purgeRemoteContainerDocument({
      documentId: "document",
      noteId: "note",
      persistence,
      runtime: {
        apiClient: {
          purgeDocument: async () => {
            throw integrityError;
          },
        },
        infra: {
          blobStore: null as never,
          dbStatus: "ready",
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql,
        },
        util: {
          log: (message) => logs.push(message),
          reportSecurityIncident: async () => undefined,
        },
      },
    }),
  ).rejects.toBe(integrityError);
  expect(localDeletes).toBe(0);
  expect(logs).toEqual([]);
});
