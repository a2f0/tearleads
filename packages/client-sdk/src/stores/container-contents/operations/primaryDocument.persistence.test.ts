import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates, importUpdates } from "@tearleads/loro";
import { primaryDocumentFixture } from "../../../../test/helpers/containerPrimaryDocument";
import { createContainerDocumentQueriesFromRuntime } from "../../../workflows/container-contents/documentQueries";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../../workflows/container-contents/metadata/containerMetadataDocument";
import { toContainerNode } from "../utils";

test("a reopened replica resolves primary by canonical identity with a different device-local id", async () => {
  const source = await primaryDocumentFixture();
  const replica = await primaryDocumentFixture();
  try {
    await source.seed("contact-a");
    await source.methods.setContainerPrimaryDocument("folder", "contact-a");
    await source.methods.renameContainer("folder", "Renamed person");
    await source.methods.setContainerIcon("folder", "star");
    const saved = await source.persistence.loadContainerMetadataState(
      source.execSql,
      "folder",
    );
    expect(saved?.record).not.toBeNull();
    if (!saved?.record) throw new Error("Expected persisted metadata");
    await replica.persistence.saveContainer(
      replica.execSql,
      saved.container,
      saved.record,
    );
    await replica.seed("contact-a");
    await replica.execSql(
      "UPDATE documents SET local_id = 'second-device-local' WHERE document_id = ?",
      ["contact-a"],
    );
    await replica.execSql(
      "UPDATE document_projection SET local_id = 'second-device-local' WHERE document_id = ?",
      ["contact-a"],
    );
    const reopened = (
      await replica.persistence.loadContainers(replica.execSql)
    )[0];
    if (!reopened?.record) throw new Error("Expected reopened container");
    const doc = await createContainerMetadataDocument("replica-peer");
    importUpdates(doc, [base64ToBytes(reopened.record.metadataUpdates ?? "")]);
    const node = toContainerNode({
      container: reopened.container,
      record: reopened.record,
      doc,
    });
    expect(node).toMatchObject({
      name: "Renamed person",
      icon: "star",
      primaryDocumentId: "contact-a",
    });
    const summary = await createContainerDocumentQueriesFromRuntime(
      replica.state.runtime,
    ).loadContainerDocumentSummary({
      containerId: node.id,
      documentId: node.primaryDocumentId ?? "",
    });
    expect(summary?.id).toBe("second-device-local");
    expect(summary?.documentId).toBe("contact-a");
  } finally {
    source.close();
    replica.close();
  }
});

test("primary patches rebase after metadata identity replacement without restoring stale name or icon", async () => {
  const f = await primaryDocumentFixture();
  try {
    await f.seed("contact-a");
    const replacement =
      await createContainerMetadataDocument("replacement-peer");
    writeContainerMetadataValue(replacement, {
      name: "Remote name",
      icon: "cloud",
      primaryDocumentId: "previous-primary",
    });
    await f.persistence.saveContainer(
      f.execSql,
      {
        ...f.live.container,
        metadataDocumentId: "replacement-id",
        name: "Remote name",
        icon: "cloud",
      },
      {
        ...f.live.record,
        documentId: "replacement-id",
        accessEpoch: 2,
        metadataUpdates: bytesToBase64(exportAllUpdates(replacement)),
      },
    );
    const saved = await f.methods.setContainerPrimaryDocument(
      "folder",
      "contact-a",
    );
    expect(saved).toMatchObject({
      name: "Remote name",
      icon: "cloud",
      primaryDocumentId: "contact-a",
    });
    expect(readContainerMetadataValue(f.live.doc, "/")).toEqual({
      name: "Remote name",
      icon: "cloud",
      primaryDocumentId: "contact-a",
    });
  } finally {
    f.close();
  }
});

test.each(["rename", "icon"])(
  "%s patch preserves replacement metadata primary",
  async (operation) => {
    const f = await primaryDocumentFixture();
    try {
      const replacement =
        await createContainerMetadataDocument("replacement-peer");
      writeContainerMetadataValue(replacement, {
        name: "Remote name",
        icon: "cloud",
        primaryDocumentId: "remote-primary",
      });
      await f.persistence.saveContainer(
        f.execSql,
        {
          ...f.live.container,
          metadataDocumentId: "replacement-id",
          name: "Remote name",
          icon: "cloud",
        },
        {
          ...f.live.record,
          documentId: "replacement-id",
          accessEpoch: 2,
          metadataUpdates: bytesToBase64(exportAllUpdates(replacement)),
        },
      );
      const saved =
        operation === "rename"
          ? await f.methods.renameContainer("folder", "Local name")
          : await f.methods.setContainerIcon("folder", "star");
      expect(saved?.primaryDocumentId).toBe("remote-primary");
      expect(
        readContainerMetadataValue(f.live.doc, "/").primaryDocumentId,
      ).toBe("remote-primary");
    } finally {
      f.close();
    }
  },
);

test.each(["failure", "replacement", "access"])(
  "%s during commit cannot leak primary into live state",
  async (reason) => {
    const f = await primaryDocumentFixture();
    try {
      await f.seed("contact-a");
      f.state.persistence = {
        ...f.persistence,
        async commitMetadataMutation(execSql, input) {
          if (reason === "failure") throw new Error("Disk write failed");
          if (reason === "replacement")
            f.state.containersById.set("folder", { ...f.live });
          if (reason === "access")
            await execSql(
              "UPDATE containers SET effective_access_level = 'read' WHERE id = 'folder'",
            );
          return f.persistence.commitMetadataMutation(execSql, input);
        },
      };
      const saving = f.methods.setContainerPrimaryDocument(
        "folder",
        "contact-a",
      );
      if (reason === "failure")
        await expect(saving).rejects.toThrow("Disk write failed");
      else expect(await saving).toBeNull();
      expect(
        readContainerMetadataValue(f.live.doc, "/").primaryDocumentId,
      ).toBeUndefined();
      expect(f.state.snapshot.nodes[0]?.primaryDocumentId).toBeNull();
      expect(
        await f.persistence.listPendingUpdates(f.execSql, "folder"),
      ).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test("clear remains allowed after the selected document is gone", async () => {
  const f = await primaryDocumentFixture();
  try {
    await f.seed("contact-a");
    await f.methods.setContainerPrimaryDocument("folder", "contact-a");
    await f.execSql("DELETE FROM document_projection WHERE document_id = ?", [
      "contact-a",
    ]);
    expect(
      await f.methods.setContainerPrimaryDocument("folder", null),
    ).toMatchObject({ primaryDocumentId: null });
  } finally {
    f.close();
  }
});
