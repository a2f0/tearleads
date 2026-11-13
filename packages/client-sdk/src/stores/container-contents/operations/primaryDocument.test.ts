import { expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import { importUpdates } from "@tearleads/loro";
import { primaryDocumentFixture } from "../../../../test/helpers/containerPrimaryDocument";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
} from "../../../workflows/container-contents/metadata/containerMetadataDocument";

test("set/change/clear persist the canonical primary and notify the container snapshot", async () => {
  const f = await primaryDocumentFixture();
  try {
    await f.seed("contact-a");
    await f.seed("contact-b");
    let notifications = 0;
    f.state.listeners.add(() => {
      notifications += 1;
    });
    for (const primaryDocumentId of ["contact-a", "contact-b", null]) {
      expect(
        await f.methods.setContainerPrimaryDocument(
          "folder",
          primaryDocumentId,
        ),
      ).toMatchObject({ primaryDocumentId });
      expect(f.state.snapshot.nodes[0]?.primaryDocumentId).toBe(
        primaryDocumentId,
      );
      const stored = await f.persistence.loadContainerMetadataState(
        f.execSql,
        "folder",
      );
      const replica = await createContainerMetadataDocument("other-device");
      importUpdates(replica, [
        base64ToBytes(stored?.record?.metadataUpdates ?? ""),
      ]);
      expect(
        readContainerMetadataValue(replica, "/").primaryDocumentId ?? null,
      ).toBe(primaryDocumentId);
      expect(readContainerMetadataValue(replica, "/")).toMatchObject({
        name: "Person",
        icon: "user",
      });
    }
    expect(notifications).toBe(3);
  } finally {
    f.close();
  }
});

test.each(["missing", "local-id", "unlinked", "unhydrated", "held"])(
  "refuses %s primary targets",
  async (reason) => {
    const f = await primaryDocumentFixture();
    try {
      await f.seed("contact-a", reason === "unlinked" ? "other" : "folder");
      if (reason === "unhydrated")
        await f.execSql(
          "UPDATE documents SET snapshot_end_version = '' WHERE local_id = ?",
          ["local-contact-a"],
        );
      if (reason === "held")
        await f.execSql(
          "INSERT INTO container_document_tombstone_holds (document_id, container_id, hidden, tombstoned_at, updated_at) VALUES (?, ?, 1, 'now', 'now')",
          ["contact-a", "folder"],
        );
      const id =
        reason === "missing"
          ? "absent"
          : reason === "local-id"
            ? "local-contact-a"
            : "contact-a";
      expect(
        await f.methods.setContainerPrimaryDocument("folder", id),
      ).toBeNull();
      expect(
        readContainerMetadataValue(f.live.doc, "/").primaryDocumentId,
      ).toBeUndefined();
      expect(
        await f.persistence.listPendingUpdates(f.execSql, "folder"),
      ).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test("membership is rechecked inside the durable commit and refusal does not leak", async () => {
  const f = await primaryDocumentFixture();
  try {
    await f.seed("contact-a");
    f.state.persistence = {
      ...f.persistence,
      async commitMetadataMutation(execSql, input) {
        await execSql(
          "UPDATE document_projection SET container_id = 'other' WHERE document_id = ?",
          ["contact-a"],
        );
        return f.persistence.commitMetadataMutation(execSql, input);
      },
    };
    await expect(
      f.methods.setContainerPrimaryDocument("folder", "contact-a"),
    ).rejects.toThrow(
      "Primary document is no longer available in this container",
    );
    expect(
      readContainerMetadataValue(f.live.doc, "/").primaryDocumentId,
    ).toBeUndefined();
    expect(f.state.snapshot.nodes[0]?.primaryDocumentId).toBeNull();
    expect(await f.persistence.listPendingUpdates(f.execSql, "folder")).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});

test("read-only containers refuse primary changes without leaking into live metadata", async () => {
  const f = await primaryDocumentFixture();
  try {
    await f.seed("contact-a");
    f.live.container.effectiveAccessLevel = "read";
    await f.persistence.saveContainer(
      f.execSql,
      f.live.container,
      f.live.record,
    );
    expect(
      await f.methods.setContainerPrimaryDocument("folder", "contact-a"),
    ).toBeNull();
    expect(
      readContainerMetadataValue(f.live.doc, "/").primaryDocumentId,
    ).toBeUndefined();
    expect(await f.persistence.listPendingUpdates(f.execSql, "folder")).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});
