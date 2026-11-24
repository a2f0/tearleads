import { expect, test } from "bun:test";
import { LoroDoc } from "loro-crdt";
import { decodeVersionVector } from "./document";
import {
  getImportBlobMetadata,
  loroDecoderIdentity,
  requireCurrentImportBlobMode,
} from "./importMetadata";

function dependencies(blob: Uint8Array) {
  return Object.fromEntries(
    decodeVersionVector(getImportBlobMetadata(blob).dependencyVersionVector)
      .toJSON()
      .entries(),
  );
}

test.each(["outdated-snapshot", "outdated-update"] as const)(
  "metadata refuses %s instead of adapting the obsolete encoding",
  (mode) => {
    expect(() => requireCurrentImportBlobMode(mode)).toThrow(
      "Obsolete Loro encoding",
    );
  },
);

test.each(["snapshot", "shallow-snapshot", "update"] as const)(
  "metadata preserves the current %s mode for the caller's protocol checks",
  (mode) => {
    expect(requireCurrentImportBlobMode(mode)).toBe(mode);
  },
);

test("the decoder identity names the loaded loro-crdt version", () => {
  expect(loroDecoderIdentity()).toMatch(/^loro-crdt@\d+\.\d+\.\d+/u);
});

test("a delta depends one past the latest op it builds on, on each peer", () => {
  const first = new LoroDoc();
  first.setPeerId("11");
  first.getText("text").insert(0, "hello");
  first.commit();
  const second = new LoroDoc();
  second.setPeerId("22");
  second.import(first.export({ mode: "update" }));
  const before = second.oplogVersion();
  second.getText("text").insert(5, " world");
  second.commit();
  second.getText("text").insert(0, ">");
  second.commit();

  expect(dependencies(second.export({ from: before, mode: "update" }))).toEqual(
    { "11": 5 },
  );
  // Ops inside the blob are no dependency, and nothing precedes a full export.
  expect(dependencies(second.export({ mode: "update" }))).toEqual({});
  expect(dependencies(second.export({ mode: "snapshot" }))).toEqual({});
});
