import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  getOrganizationProfileDocumentLocalId,
  readOrganizationProfileName,
} from "./organizationProfile";

/**
 * A locally-known organization the user belongs to, derived from its persisted
 * root container. `name` is the decrypted organization-profile display name when
 * one is stored locally, or null when it has not synced yet.
 */
export interface LocalOrganizationSummary {
  name: string | null;
  organizationId: string;
  rootContainerId: string;
}

async function readLocalOrganizationName(
  execSql: ExecSql,
  organizationId: string,
): Promise<string | null> {
  const record = await sqlDocumentsPersistence.loadDocument(
    execSql,
    getOrganizationProfileDocumentLocalId({ organizationId }),
  );
  if (!record?.loroSnapshot) {
    return null;
  }

  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  importUpdates(doc, [base64ToBytes(record.loroSnapshot)]);
  return readOrganizationProfileName(
    readStoredDocumentState(doc).structuredFields,
  );
}

/**
 * Enumerates the organizations the user can manage from local state: one per
 * persisted root container. This is intentionally offline — the Explorer already
 * resolves files across organizations by effective permission, so listing the
 * organizations to manage needs no server round-trip.
 */
export async function listLocalOrganizations(input: {
  execSql: ExecSql;
}): Promise<LocalOrganizationSummary[]> {
  const containers = await sqlContainerContentsPersistence.loadContainers(
    input.execSql,
  );
  const summaries: LocalOrganizationSummary[] = [];
  const seen = new Set<string>();
  for (const { container } of containers) {
    if (container.parentId !== null || seen.has(container.organizationId)) {
      continue;
    }
    seen.add(container.organizationId);
    summaries.push({
      name: await readLocalOrganizationName(
        input.execSql,
        container.organizationId,
      ),
      organizationId: container.organizationId,
      rootContainerId: container.id,
    });
  }
  return summaries;
}
