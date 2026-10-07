import { expect, test } from "bun:test";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createCurrentOrganizationRuntimeFixture } from "../../../test/helpers/currentOrganizationRuntime";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import { inheritPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import { createRuntimeGroupMetadataAccess } from "./groupMetadataRuntime";

test.each(["bounded", "no lease", "no pages"] as const)(
  "metadata runtime verifies reserved-group lineage with %s capabilities",
  async (mode) => {
    const f = await createCurrentOrganizationRuntimeFixture({
      allowFullReads: mode !== "bounded",
      withLease: mode !== "no lease",
    });
    try {
      const organizationId = f.signed.artifacts.organizationId;
      await ensureContainerTables(f.options.execSql);
      await saveContainer(f.options.execSql, {
        id: f.projection.containerId,
        organizationId,
        parentId: null,
        metadataDocumentId: null,
        systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
          organizationId,
        }),
        name: "Metadata",
        icon: null,
      });
      const api = f.runtime.apiClient;
      const withoutPages = {
        getCurrentPrincipalPolicy: api.getCurrentPrincipalPolicy.bind(api),
        getContainerWriterProjection:
          api.getContainerWriterProjection.bind(api),
        evictContainerWriterProjection:
          api.evictContainerWriterProjection.bind(api),
      };
      const runtime = inheritPrincipalHistoryProtection(f.runtime, {
        ...f.runtime,
        apiClient: mode === "no pages" ? withoutPages : f.runtime.apiClient,
      });
      const access = createRuntimeGroupMetadataAccess(runtime, organizationId);
      await expect(access.loadEncryptionKey()).rejects.toThrow(
        "Organization metadata root is still behind the signed directory after a reload",
      );
      if (mode === "bounded") {
        expect(f.fullReads()).toBe(0);
        expect(f.requests.length).toBeGreaterThan(0);
      } else {
        expect(f.fullReads()).toBeGreaterThan(0);
        expect(f.requests).toHaveLength(0);
      }
    } finally {
      f.close();
    }
  },
);
