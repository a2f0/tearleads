import { expect, test } from "bun:test";
import {
  createAccessManifestBundle,
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
  jsonRoundTrip,
} from "../operation/openApiTestFixtures";
import type { ContainerWriterProjectionResponse } from "./container";
import type { DocumentWriterProjectionResponse } from "./documentMutation";
import {
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
  encodeContainerWriterProjection,
  encodeDocumentWriterProjection,
} from "./writerProjectionWire";

function bundle(manifestHash: string) {
  return { ...createAccessManifestBundle(), manifestHash };
}

function containerProjection(): ContainerWriterProjectionResponse {
  const fixture = createContainerWriterProjectionResponse();
  const [kek] = fixture.containerKeks;
  if (!kek) throw new Error("fixture KEK missing");
  return {
    ...fixture,
    path: [bundle("root"), bundle("leaf")],
    containerKeks: [
      { ...kek, containerManifestHistory: [bundle("root-genesis")] },
      {
        ...kek,
        containerManifestHistory: [bundle("root"), bundle("leaf-genesis")],
      },
    ],
  };
}

function documentProjection(): DocumentWriterProjectionResponse {
  const path = containerProjection();
  return {
    ...createDocumentWriterProjectionResponse(),
    authorizingContainerPaths: [path, path],
    documentContainerManifestHistory: [bundle("leaf-genesis")],
    documentManifest: bundle("document"),
    documentManifestContainerPaths: [
      [bundle("root"), bundle("leaf")],
      [bundle("root"), bundle("leaf-genesis")],
    ],
    documentManifestHistory: [bundle("document-genesis")],
  };
}

test("each distinct manifest travels once and every position cites it", () => {
  const wire = jsonRoundTrip(
    encodeDocumentWriterProjection(documentProjection()),
  );
  expect(Object.keys(Reflect.get(Object(wire), "bundles")).sort()).toEqual([
    "document",
    "document-genesis",
    "leaf",
    "leaf-genesis",
    "root",
    "root-genesis",
  ]);
  expect(Reflect.get(Object(wire), "documentManifest")).toBe("document");
  expect(Reflect.get(Object(wire), "documentManifestContainerPaths")).toEqual([
    ["root", "leaf"],
    ["root", "leaf-genesis"],
  ]);
  expect(decodeDocumentWriterProjection(wire)).toEqual(documentProjection());
  expect(
    decodeContainerWriterProjection(
      jsonRoundTrip(encodeContainerWriterProjection(containerProjection())),
    ),
  ).toEqual(containerProjection());
});

test("decoded positions are independent copies of one bundle", () => {
  const decoded = decodeContainerWriterProjection(
    jsonRoundTrip(encodeContainerWriterProjection(containerProjection())),
  );
  const root = decoded?.path[0];
  const cited = decoded?.containerKeks[1]?.containerManifestHistory[0];
  if (!root || !cited) throw new Error("decoded positions missing");
  expect(cited).toEqual(root);
  expect(cited).not.toBe(root);
  Reflect.set(root.state, "mutated", true);
  expect(cited.state).not.toHaveProperty("mutated");
});

test("an inconsistent bundle map fails closed", () => {
  const wire = encodeContainerWriterProjection(containerProjection());
  const { leaf, ...withoutLeaf } = wire.bundles;
  if (!leaf) throw new Error("leaf bundle missing");
  for (const bundles of [
    // A cited hash with no bundle.
    withoutLeaf,
    // A bundle stored under a key other than its manifestHash.
    { ...withoutLeaf, leaf: { ...leaf, manifestHash: "other" } },
    // A bundle no position cites.
    { ...wire.bundles, extra: bundle("extra") },
    // A wire key that names an object prototype is an ordinary uncited key.
    JSON.parse(
      `{"__proto__":${JSON.stringify(bundle("__proto__"))},${JSON.stringify(wire.bundles).slice(1)}`,
    ),
  ]) {
    expect(
      decodeContainerWriterProjection(jsonRoundTrip({ ...wire, bundles })),
    ).toBeNull();
  }
  expect(decodeContainerWriterProjection(jsonRoundTrip(wire))).not.toBeNull();
  // A decoded projection is not accepted as the wire shape.
  expect(decodeContainerWriterProjection(containerProjection())).toBeNull();
});

test("a document's bundle map must cover every cited list", () => {
  const wire = encodeDocumentWriterProjection(documentProjection());
  const { "document-genesis": _history, ...withoutHistory } = wire.bundles;
  expect(
    decodeDocumentWriterProjection(
      jsonRoundTrip({ ...wire, bundles: withoutHistory }),
    ),
  ).toBeNull();
  expect(
    decodeDocumentWriterProjection(
      jsonRoundTrip({ ...wire, documentManifest: "missing" }),
    ),
  ).toBeNull();
});

test("a request's known hashes are cited but not served", () => {
  const known = new Set(["root", "leaf-genesis", "never-cited"]);
  const wire = jsonRoundTrip(
    encodeDocumentWriterProjection(documentProjection(), known),
  );
  expect(Object.keys(Reflect.get(Object(wire), "bundles")).sort()).toEqual([
    "document",
    "document-genesis",
    "leaf",
    "root-genesis",
  ]);
  expect(Reflect.get(Object(wire), "omittedBundles")).toEqual([
    "root",
    "leaf-genesis",
  ]);
  // Rebuilding needs the exact bytes the request cited.
  expect(decodeDocumentWriterProjection(wire)).toBeNull();
  const held = new Map([
    ["root", bundle("root")],
    ["leaf-genesis", bundle("leaf-genesis")],
  ]);
  expect(decodeDocumentWriterProjection(wire, held)).toEqual(
    documentProjection(),
  );
  // A held bundle stored under another hash fills nothing.
  expect(
    decodeDocumentWriterProjection(
      wire,
      new Map([...held, ["root", bundle("other")]]),
    ),
  ).toBeNull();
});

test("an omission must be cited, unique, and not also served", () => {
  const wire = encodeContainerWriterProjection(
    containerProjection(),
    new Set(["root"]),
  );
  const held = new Map([["root", bundle("root")]]);
  expect(decodeContainerWriterProjection(jsonRoundTrip(wire), held)).toEqual(
    containerProjection(),
  );
  for (const omittedBundles of [
    ["root", "root"],
    ["root", "uncited"],
    ["root", "leaf"],
  ]) {
    expect(
      decodeContainerWriterProjection(
        jsonRoundTrip({ ...wire, omittedBundles }),
        new Map([...held, ["leaf", bundle("leaf")]]),
      ),
    ).toBeNull();
  }
  const { omittedBundles: _omitted, ...withoutOmissions } = wire;
  expect(
    decodeContainerWriterProjection(jsonRoundTrip(withoutOmissions), held),
  ).toBeNull();
});
