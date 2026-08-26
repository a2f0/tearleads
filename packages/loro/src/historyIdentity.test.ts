import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
} from "./document";
import { updateMatchesDocumentHistory } from "./updateIdentity";

test("full-history identity is stable after snapshot import", async () => {
  const source = await createDocument("history-identity-source");
  source.getText("text").update("first");
  source.commit();
  source.getText("text").update("first second");
  source.commit();
  const restored = await createDocument("history-identity-restored");
  importSnapshot(restored, exportFullHistorySnapshot(source));

  expect(exportFullHistoryIdentity(restored)).toBe(
    exportFullHistoryIdentity(source),
  );
});

test("full-history identity detects forged operations at the same frontier", async () => {
  const genuine = await createDocument("history-identity-fork");
  genuine.getText("text").update("genuine first");
  genuine.commit();
  genuine.getText("text").update("genuine second");
  genuine.commit();
  const forged = await createDocument("history-identity-fork");
  forged.getText("text").update("forged! first");
  forged.commit();
  forged.getText("text").update("forged! second");
  forged.commit();

  expect(encodeVersionVector(forged)).toBe(encodeVersionVector(genuine));
  expect(exportFullHistoryIdentity(forged)).not.toBe(
    exportFullHistoryIdentity(genuine),
  );
});

test("full-history identity distinguishes binary data from the same base64 string", async () => {
  const binary = await createDocument("history-identity-binary-string");
  const bytes = new TextEncoder().encode("same visible representation");
  binary.getMap("fields").set("value", bytes);
  binary.commit();
  const text = await createDocument("history-identity-binary-string");
  text.getMap("fields").set("value", bytesToBase64(bytes));
  text.commit();

  expect(encodeVersionVector(text)).toBe(encodeVersionVector(binary));
  expect(exportFullHistoryIdentity(text)).not.toBe(
    exportFullHistoryIdentity(binary),
  );
});

test("full-history identity can compare a retained prefix", async () => {
  const source = await createDocument("history-identity-prefix-source");
  source.getText("text").update("retained prefix");
  source.commit();
  const sourceVersion = encodeVersionVector(source);
  const ahead = await createDocument("history-identity-prefix-ahead");
  importSnapshot(ahead, exportFullHistorySnapshot(source));
  ahead.getText("text").update("retained prefix plus concurrent work");
  ahead.commit();

  expect(exportFullHistoryIdentity(ahead, sourceVersion)).toBe(
    exportFullHistoryIdentity(source),
  );
});

test("update identity matches only the document's exact operation range", async () => {
  const genuine = await createDocument("history-update-identity");
  genuine.getText("text").update("retained prefix");
  genuine.commit();
  const startVersion = encodeVersionVector(genuine);
  genuine.getText("text").update("genuine suffix");
  genuine.commit();
  const genuineUpdate = exportUpdatesSince(genuine, startVersion);

  const forged = await createDocument("history-update-identity");
  forged.getText("text").update("retained prefix");
  forged.commit();
  forged.getText("text").update("forged! suffix");
  forged.commit();
  const forgedUpdate = exportUpdatesSince(forged, startVersion);

  expect(updateMatchesDocumentHistory(genuine, genuineUpdate)).toBe(true);
  expect(updateMatchesDocumentHistory(genuine, forgedUpdate)).toBe(false);
});
