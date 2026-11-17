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

function servedBundle(manifestHash: string) {
  const { state: _state, ...served } = bundle(manifestHash);
  return served;
}

const REBUILT_STATE = createAccessManifestBundle().state;

/** Rebuilds every served bundle's state as the fixture's stored state. */
function decoding(held?: ReadonlyMap<string, unknown>) {
  return {
    held: held as ReadonlyMap<string, ReturnType<typeof servedBundle>>,
    reconstructStates: (bundles: ReadonlyMap<string, unknown>) =>
      new Map([...bundles.keys()].map((hash) => [hash, REBUILT_STATE])),
  };
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
  expect(decodeDocumentWriterProjection(wire, decoding())).toEqual(
    documentProjection(),
  );
  expect(
    decodeContainerWriterProjection(
      jsonRoundTrip(encodeContainerWriterProjection(containerProjection())),
      decoding(),
    ),
  ).toEqual(containerProjection());
});

test("decoded positions are independent copies of one bundle", () => {
  const decoded = decodeContainerWriterProjection(
    jsonRoundTrip(encodeContainerWriterProjection(containerProjection())),
    decoding(),
  );
  const root = decoded?.path[0];
  const cited = decoded?.containerKeks[1]?.containerManifestHistory[0];
  if (!root || !cited) throw new Error("decoded positions missing");
  expect(cited).toEqual(root);
  expect(cited).not.toBe(root);
  Reflect.set(root.state, "mutated", true);
  expect(cited.state).not.toHaveProperty("mutated");
});

test("served bundles omit the derived state, which decoding rebuilds", () => {
  const wire = jsonRoundTrip(
    encodeContainerWriterProjection(containerProjection(), new Set(["root"])),
  );
  const served = Reflect.get(Object(wire), "bundles");
  expect(served.leaf).toEqual(servedBundle("leaf"));
  for (const value of Object.values(Object(served)))
    expect(value).not.toHaveProperty("state");

  // The rebuilder sees only stateless bytes, held ones included; a bundle
  // it cannot rebuild decodes with an empty state the verifier refuses.
  const seen: unknown[] = [];
  const decoded = decodeContainerWriterProjection(wire, {
    held: new Map([["root", bundle("root")]]),
    reconstructStates: (bundles) => {
      seen.push(...bundles.values());
      return new Map([["leaf", { epoch: 2 }]]);
    },
  });
  expect(seen).toHaveLength(4);
  for (const value of seen) expect(value).not.toHaveProperty("state");
  expect(decoded?.path.map((entry) => entry.state)).toEqual([{}, { epoch: 2 }]);
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
      decodeContainerWriterProjection(
        jsonRoundTrip({ ...wire, bundles }),
        decoding(),
      ),
    ).toBeNull();
  }
  expect(
    decodeContainerWriterProjection(jsonRoundTrip(wire), decoding()),
  ).not.toBeNull();
  // A decoded projection is not accepted as the wire shape.
  expect(
    decodeContainerWriterProjection(containerProjection(), decoding()),
  ).toBeNull();
});

test("a document's bundle map must cover every cited list", () => {
  const wire = encodeDocumentWriterProjection(documentProjection());
  const { "document-genesis": _history, ...withoutHistory } = wire.bundles;
  expect(
    decodeDocumentWriterProjection(
      jsonRoundTrip({ ...wire, bundles: withoutHistory }),
      decoding(),
    ),
  ).toBeNull();
  expect(
    decodeDocumentWriterProjection(
      jsonRoundTrip({ ...wire, documentManifest: "missing" }),
      decoding(),
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
  expect(decodeDocumentWriterProjection(wire, decoding())).toBeNull();
  const held = new Map([
    ["root", servedBundle("root")],
    ["leaf-genesis", servedBundle("leaf-genesis")],
  ]);
  expect(decodeDocumentWriterProjection(wire, decoding(held))).toEqual(
    documentProjection(),
  );
  // A held bundle stored under another hash fills nothing.
  expect(
    decodeDocumentWriterProjection(
      wire,
      decoding(new Map([...held, ["root", servedBundle("other")]])),
    ),
  ).toBeNull();
});

test("an omission must be cited, unique, and not also served", () => {
  const wire = encodeContainerWriterProjection(
    containerProjection(),
    new Set(["root"]),
  );
  const held = new Map([["root", servedBundle("root")]]);
  expect(
    decodeContainerWriterProjection(jsonRoundTrip(wire), decoding(held)),
  ).toEqual(containerProjection());
  for (const omittedBundles of [
    ["root", "root"],
    ["root", "uncited"],
    ["root", "leaf"],
  ]) {
    expect(
      decodeContainerWriterProjection(
        jsonRoundTrip({ ...wire, omittedBundles }),
        decoding(new Map([...held, ["leaf", servedBundle("leaf")]])),
      ),
    ).toBeNull();
  }
  const { omittedBundles: _omitted, ...withoutOmissions } = wire;
  expect(
    decodeContainerWriterProjection(
      jsonRoundTrip(withoutOmissions),
      decoding(held),
    ),
  ).toBeNull();
});
