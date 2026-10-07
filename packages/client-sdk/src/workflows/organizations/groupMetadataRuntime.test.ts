import { expect, test } from "bun:test";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createCurrentOrganizationRuntimeFixture } from "../../../test/helpers/currentOrganizationRuntime";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import { inheritPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import { createRuntimeGroupMetadataAccess } from "./groupMetadataRuntime";

test("metadata key unwrapping reuses exact private evidence and refuses a different signed head", async () => {
  const f = await createCurrentOrganizationRuntimeFixture({ aligned: true });
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
    const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver(
      f.runtime,
    );
    if (!resolveCurrentPolicy)
      throw new Error("Missing current-policy resolver");
    const authority = await loadCurrentOrganizationAuthority({
      organizationId,
      organizationReference: f.projection.policyEvidence.organization?.head,
      execSql: f.options.execSql,
      resolveCurrentPolicy,
      stillCurrent: () => true,
    });
    await authority.readGroup(authority.descriptor.memberGroupId);
    f.requests.length = 0;
    const key = await createRuntimeGroupMetadataAccess(
      f.runtime,
      organizationId,
    ).loadEncryptionKey();
    expect(key.containerId).toBe(f.projection.containerId);
    expect(key.keyMaterial.byteLength).toBe(32);
    expect(f.requests).toEqual([]);
    expect(f.fullReads()).toBe(0);
    const member = f.projection.policyEvidence.groups.find(
      (source) =>
        source.head.principalId === authority.descriptor.memberGroupId,
    );
    if (!member) throw new Error("Missing signed metadata group source");
    member.head.stateHash = "f".repeat(64);
    await expect(
      createRuntimeGroupMetadataAccess(
        f.runtime,
        organizationId,
      ).loadEncryptionKey(),
    ).rejects.toThrow();
    expect(f.requests).toEqual([]);
    expect(f.fullReads()).toBe(0);
  } finally {
    f.close();
  }
});

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
      if (mode === "bounded") {
        const head = f.projection.policyEvidence.organization?.head;
        if (!head) throw new Error("Missing projected directory head");
        head.principalId = "foreign-organization";
        await expect(
          createRuntimeGroupMetadataAccess(
            runtime,
            organizationId,
          ).loadEncryptionKey(),
        ).rejects.toThrow("Current policy reference is outside its scope");
        expect(f.requests).toHaveLength(0);
        head.principalId = organizationId;
      }
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
