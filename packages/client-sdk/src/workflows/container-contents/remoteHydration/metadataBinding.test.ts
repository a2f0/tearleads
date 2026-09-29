import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createMetadataBindingFixture } from "../../../../test/helpers/containerMetadataBinding";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { renameContainerMetadataStateFromRuntime } from "../metadataPersistence";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

test("ordinary child hydration derives its metadata target from the signed folder", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const fixture = await createMetadataBindingFixture(execSql);
    const hydrated = await fixture.hydrate();
    expect(hydrated?.container.metadataDocumentId).toBe(
      fixture.metadataDocumentId,
    );
    const [stored] =
      await sqlContainerContentsPersistence.loadContainers(execSql);
    expect(stored?.record?.documentId).toBe(fixture.metadataDocumentId);
    expect(fixture.projectionReads()).toBe(1);
  } finally {
    close();
  }
});

test("tombstone recovery already protects dormant metadata from a forged listing id", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const fixture = await createMetadataBindingFixture(execSql);
    const doc = await createContainerMetadataDocument(fixture.listed.id);
    writeContainerMetadataValue(doc, {
      icon: null,
      name: "Private queued rename",
    });
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: fixture.listed.id,
        organizationId: fixture.listed.organizationId,
        parentId: fixture.listed.parentId,
        metadataDocumentId: fixture.metadataDocumentId,
        effectiveAccessLevel: "admin",
        name: "Private queued rename",
        icon: null,
      },
      {
        id: fixture.listed.id,
        documentId: fixture.metadataDocumentId,
        accessEpoch: 1,
        accessStateHash: "retained",
        metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
        snapshotEndVersion: "",
      },
    );
    await execSql(
      `INSERT INTO document_pending_updates
      (id, app_kind, local_id, update_data, partial_start_version_vector, partial_end_version_vector, created_at)
      VALUES ('pending-private-rename', 'container-metadata', ?, 'data', '', '', 'now')`,
      [fixture.listed.id],
    );
    await sqlContainerContentsPersistence.deleteContainers(
      execSql,
      [
        {
          containerId: fixture.listed.id,
          reason: "access_revoked",
          updatedAt: fixture.listed.updatedAt,
        },
      ],
      { discoveryOnly: true },
    );
    expect(
      await sqlContainerContentsPersistence.loadContainerMetadataRecord(
        execSql,
        fixture.listed.id,
      ),
    ).not.toBeNull();
    const hydrated = await fixture.hydrate();
    expect(hydrated?.container.name).toBe("Private queued rename");
    expect(hydrated?.record.documentId).toBe(fixture.metadataDocumentId);
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        fixture.listed.id,
      ),
    ).toMatchObject([{ id: "pending-private-rename" }]);
  } finally {
    close();
  }
});

test("a changed listing cannot retarget pending metadata edits on a live child", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const fixture = await createMetadataBindingFixture(execSql);
    const hydrated = await fixture.hydrate();
    if (!hydrated) throw new Error("Expected initial hydration");
    const renamed = await renameContainerMetadataStateFromRuntime({
      metadataState: hydrated,
      name: "Private queued rename",
      persistence: sqlContainerContentsPersistence,
      runtime: fixture.state.runtime,
    });
    if (!renamed) throw new Error("Expected a durable rename");
    hydrated.container = renamed.container;
    hydrated.record = renamed.record;
    const pending = await sqlContainerContentsPersistence.listPendingUpdates(
      execSql,
      fixture.listed.id,
    );
    expect(pending.length).toBeGreaterThan(0);
    fixture.listed.metadataDocumentId = "another-decoy";
    const again = await fixture.hydrate();
    expect(again?.container.name).toBe("Private queued rename");
    expect(again?.record.documentId).toBe(fixture.metadataDocumentId);
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        fixture.listed.id,
      ),
    ).toEqual(pending);
    expect(fixture.projectionReads()).toBe(1);
  } finally {
    close();
  }
});

test("cached metadata bindings do not freeze an ordinary child's parent", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const fixture = await createMetadataBindingFixture(execSql);
    await fixture.hydrate();
    const moved = await verifyRemoteContainerDestination({
      heldBinding: null,
      remoteContainer: { ...fixture.listed, parentId: "new-listed-parent" },
      state: fixture.state,
    });
    expect(moved?.metadataDocumentId).toBe(fixture.metadataDocumentId);
    expect(moved?.parentId).toBe("new-listed-parent");
    expect(fixture.projectionReads()).toBe(1);
    await expect(
      verifyRemoteContainerDestination({
        heldBinding: null,
        remoteContainer: {
          ...fixture.listed,
          organizationId: "other-organization",
        },
        state: fixture.state,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    close();
  }
});

test("unauthenticated metadata bindings never persist or enter the cache", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const fixture = await createMetadataBindingFixture(execSql);
    const leaf = fixture.projection.path.at(-1);
    if (!leaf) throw new Error("Expected a signed child event");
    const signedEvent = leaf.event.event;
    leaf.event.event = {
      ...signedEvent,
      signedAt: "2026-09-29T00:00:00.000Z",
    };
    await expect(fixture.hydrate()).rejects.toMatchObject({
      code: "signature_mismatch",
    });
    expect(fixture.incidents).toHaveLength(1);
    expect(
      await sqlContainerContentsPersistence.loadContainers(execSql),
    ).toEqual([]);
    expect(
      await sqlContainerContentsPersistence.listPendingUpdates(
        execSql,
        fixture.listed.id,
      ),
    ).toEqual([]);
    leaf.event.event = signedEvent;
    const hydrated = await fixture.hydrate();
    expect(hydrated?.record.documentId).toBe(fixture.metadataDocumentId);
    expect(fixture.projectionReads()).toBe(2);
  } finally {
    close();
  }
});
