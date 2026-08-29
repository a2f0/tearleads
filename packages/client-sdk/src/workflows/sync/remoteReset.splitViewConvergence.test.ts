import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  getTextValue,
  importSnapshot,
  importUpdates,
  versionVectorsEqual,
} from "@symcrypt/loro";

test("split-view full-history republishes converge through one server baseline", async () => {
  const baseline = await createDocument("pre-purge-baseline");
  baseline.getText("text").update("base");
  baseline.commit();

  const left = await createDocument("same-org:left-pane");
  const right = await createDocument("same-org:right-pane");
  importSnapshot(left, exportFullHistorySnapshot(baseline));
  importSnapshot(right, exportFullHistorySnapshot(baseline));
  left.getText("text").insert(0, "left ");
  left.commit();
  right.getText("text").insert(4, " right");
  right.commit();

  // The first recovered client creates the preserved remote document id; the
  // second adopts that same id and uploads its own full history. The server's
  // logical frontier is the union of both ordinary update histories.
  const server = await createDocument("recovered-server-union");
  importUpdates(server, [exportAllUpdates(left), exportAllUpdates(right)]);
  const serverBaseline = exportFullHistorySnapshot(server);
  importSnapshot(left, serverBaseline);
  importSnapshot(right, serverBaseline);

  expect(getTextValue(left)).toContain("left ");
  expect(getTextValue(left)).toContain(" right");
  expect(getTextValue(right)).toBe(getTextValue(left));
  expect(
    versionVectorsEqual(encodeVersionVector(left), encodeVersionVector(right)),
  ).toBe(true);
  expect(exportFullHistoryIdentity(left)).toBe(
    exportFullHistoryIdentity(right),
  );
});

test("a same-peer collision has equal frontiers but a different history identity", async () => {
  const genuine = await createDocument("accidentally-shared-pane-peer");
  const collision = await createDocument("accidentally-shared-pane-peer");
  genuine.getText("text").update("genuine pane update");
  genuine.commit();
  collision.getText("text").update("colliding pane edit");
  collision.commit();

  expect(encodeVersionVector(collision)).toBe(encodeVersionVector(genuine));
  expect(exportFullHistoryIdentity(collision)).not.toBe(
    exportFullHistoryIdentity(genuine),
  );
});
