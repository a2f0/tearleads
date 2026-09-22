import { expect, test } from "bun:test";
import { createContainerDocumentTombstoneVerifier } from "./documentTombstoneEvidence";

const at = "2026-09-20T00:00:00.000Z";

test("tombstones are judged once per document against the verified head link set", async () => {
  const loads: string[] = [];
  const verify = createContainerDocumentTombstoneVerifier(
    async (documentId) => {
      loads.push(documentId);
      if (documentId === "linked") return ["kept", "still-linked"];
      if (documentId === "purged") return [];
      return null;
    },
  );

  const verdicts = await verify([
    { containerId: "still-linked", documentId: "linked", updatedAt: at },
    { containerId: "gone", documentId: "linked", updatedAt: at },
    { containerId: "anywhere", documentId: "purged", updatedAt: at },
    { containerId: "folder", documentId: "unreadable", updatedAt: at },
  ]);

  expect(loads).toEqual(["linked", "purged", "unreadable"]);
  expect(verdicts).toEqual([
    {
      kind: "refuted",
      tombstone: {
        containerId: "still-linked",
        documentId: "linked",
        updatedAt: at,
      },
    },
    {
      kind: "verified",
      tombstone: {
        containerId: "gone",
        documentId: "linked",
        linkedContainerIds: ["kept", "still-linked"],
        updatedAt: at,
      },
    },
    {
      kind: "verified",
      tombstone: {
        containerId: "anywhere",
        documentId: "purged",
        linkedContainerIds: [],
        updatedAt: at,
      },
    },
    {
      kind: "unverified",
      tombstone: {
        containerId: "folder",
        documentId: "unreadable",
        updatedAt: at,
      },
    },
  ]);
});
