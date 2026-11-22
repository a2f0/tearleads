import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import {
  documentVersionCovers,
  parseDocumentVersionFrontier,
} from "./documentUpdateStore";

test("a version covers another only when it holds every op of each peer", async () => {
  const first = await createDocument("covers-first");
  first.getText("t").insert(0, "a");
  first.commit();
  const one = parseDocumentVersionFrontier(encodeVersionVector(first));
  first.getText("t").insert(1, "b");
  first.commit();
  const two = parseDocumentVersionFrontier(encodeVersionVector(first));
  const other = await createDocument("covers-other");
  other.getText("t").insert(0, "c");
  other.commit();
  const otherPeer = parseDocumentVersionFrontier(encodeVersionVector(other));
  const empty = { frontierJson: "[]" };

  // Equal counters cover each other.
  expect(documentVersionCovers(one, one)).toBe(true);
  expect(documentVersionCovers(two, one)).toBe(true);
  expect(documentVersionCovers(one, two)).toBe(false);
  // A peer the version lacks counts as no ops from it.
  expect(documentVersionCovers(two, otherPeer)).toBe(false);
  expect(documentVersionCovers(empty, one)).toBe(false);
  expect(documentVersionCovers(one, empty)).toBe(true);
});
