import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import { extendDocumentVersionCoverage } from "./versionCoverage";

test("version coverage connects durable spans to a fixed point", async () => {
  const document = await createDocument("coverage-writer");
  const baseVersion = encodeVersionVector(document);

  document.getText("text").update("one");
  document.commit();
  const first = getUpdateVersionVectors(
    exportUpdatesSince(document, baseVersion),
  );
  const firstVersion = encodeVersionVector(document);

  document.getText("text").update("two");
  document.commit();
  const second = getUpdateVersionVectors(
    exportUpdatesSince(document, firstVersion),
  );
  const documentVersion = encodeVersionVector(document);

  const coverage = extendDocumentVersionCoverage({
    baseVersion,
    documentVersion,
    spans: [second, first],
  });

  expect(versionVectorsEqual(coverage, documentVersion)).toBe(true);
});

test("version coverage rejects gaps, malformed spans, and foreign ends", async () => {
  const document = await createDocument("coverage-local");
  const baseVersion = encodeVersionVector(document);
  document.getText("text").update("local");
  document.commit();
  const middleVersion = encodeVersionVector(document);
  document.getText("text").update("local tail");
  document.commit();
  const disconnected = getUpdateVersionVectors(
    exportUpdatesSince(document, middleVersion),
  );

  const foreign = await createDocument("coverage-foreign");
  foreign.getText("text").update("foreign");
  foreign.commit();
  const foreignSpan = getUpdateVersionVectors(
    exportUpdatesSince(foreign, undefined),
  );

  const coverage = extendDocumentVersionCoverage({
    baseVersion,
    documentVersion: encodeVersionVector(document),
    spans: [
      disconnected,
      foreignSpan,
      {
        partialEndVersionVector: "invalid",
        partialStartVersionVector: "invalid",
      },
    ],
  });

  expect(versionVectorsEqual(coverage, baseVersion)).toBe(true);
  expect(() =>
    extendDocumentVersionCoverage({
      baseVersion: foreignSpan.partialEndVersionVector,
      documentVersion: encodeVersionVector(document),
      spans: [],
    }),
  ).toThrow("outside the current snapshot");
});

test("remote coverage does not cross a local deferred operation", async () => {
  const baseline = await createDocument("coverage-baseline");
  baseline.getMap("meta").set("baseline", true);
  baseline.commit();
  const baselineUpdate = exportUpdatesSince(baseline, undefined);

  const local = await createDocument("coverage-local-peer");
  const remote = await createDocument("coverage-remote-peer");
  importUpdates(local, [baselineUpdate]);
  importUpdates(remote, [baselineUpdate]);
  const baseVersion = encodeVersionVector(local);

  local.getMap("meta").set("localDeferred", true);
  local.commit();
  remote.getMap("meta").set("remoteSynced", true);
  remote.commit();
  const remoteUpdate = exportUpdatesSince(remote, baseVersion);
  const remoteSpan = getUpdateVersionVectors(remoteUpdate);
  importUpdates(local, [remoteUpdate]);

  const coverage = extendDocumentVersionCoverage({
    baseVersion,
    documentVersion: encodeVersionVector(local),
    spans: [remoteSpan],
  });
  const localTail = exportUpdatesSince(local, coverage);
  importUpdates(remote, [localTail]);

  expect(remote.getMap("meta").get("localDeferred")).toBe(true);
  expect(remote.getMap("meta").get("remoteSynced")).toBe(true);
});
