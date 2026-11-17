import { expect, test } from "bun:test";
import {
  createAccessManifestBundle,
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
  jsonRoundTrip,
} from "../operation/openApiTestFixtures";
import { toServedAccessManifestBundle } from "../util";
import type { ContainerWriterProjectionResponse } from "./container";
import type { DocumentWriterProjectionResponse } from "./documentMutation";
import {
  acceptDecodedProjection,
  decodeContainerWriterProjection,
  decodeDocumentWriterProjection,
  deriveDecodedProjection,
  encodeContainerWriterProjection,
  encodeDocumentWriterProjection,
  heldBundlesUsedBy,
  isRejectedDecodedProjection,
  rejectDecodedProjection,
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
    ["root", toServedAccessManifestBundle(bundle("root"))],
    ["leaf-genesis", toServedAccessManifestBundle(bundle("leaf-genesis"))],
  ]);
  expect(decodeDocumentWriterProjection(wire, held)).toEqual(
    documentProjection(),
  );
  // A held bundle stored under another hash fills nothing.
  expect(
    decodeDocumentWriterProjection(
      wire,
      new Map([
        ...held,
        ["root", toServedAccessManifestBundle(bundle("other"))],
      ]),
    ),
  ).toBeNull();
});

test("an omission must be cited, unique, and not also served", () => {
  const wire = encodeContainerWriterProjection(
    containerProjection(),
    new Set(["root"]),
  );
  const held = new Map([
    ["root", toServedAccessManifestBundle(bundle("root"))],
  ]);
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
        new Map([
          ...held,
          ["leaf", toServedAccessManifestBundle(bundle("leaf"))],
        ]),
      ),
    ).toBeNull();
  }
  const { omittedBundles: _omitted, ...withoutOmissions } = wire;
  expect(
    decodeContainerWriterProjection(jsonRoundTrip(withoutOmissions), held),
  ).toBeNull();
});

test("a served state omits what the bundle's signed bytes name", () => {
  const signed = {
    event: {
      body: {
        eventType: "container.grant",
        containerKeyEpochId: "epoch-1",
        containerKeyPublicKey: "public-key",
      },
      event: { signature: "signed-event" },
      eventHash: "event-hash",
    },
    manifest: {
      version: 1,
      objectKind: "container",
      objectId: "container-1",
      organizationId: "organization-1",
      epoch: 2,
      previousManifestHash: "previous-hash",
      eventHash: "event-hash",
    },
    manifestHash: "root",
  };
  const stored = {
    ...signed,
    state: {
      version: 1,
      containerId: "container-1",
      organizationId: "organization-1",
      epoch: 2,
      previousManifestHash: "previous-hash",
      eventHash: "event-hash",
      containerKeyEpochId: "epoch-1",
      containerKeyPublicKey: "public-key",
      directGrants: [],
    },
  };
  const projection = { ...containerProjection(), path: [stored] };
  const [kek] = projection.containerKeks;
  if (!kek) throw new Error("fixture KEK missing");
  projection.containerKeks = [{ ...kek, containerManifestHistory: [] }];
  const wire = jsonRoundTrip(encodeContainerWriterProjection(projection));
  expect(Reflect.get(Reflect.get(Object(wire), "bundles"), "root")).toEqual({
    ...signed,
    state: { directGrants: [] },
  });
  expect(decodeContainerWriterProjection(wire)?.path).toEqual([stored]);
  // The signed bytes win over a served copy of the same field.
  const forged = Object(jsonRoundTrip(wire));
  Reflect.set(forged.bundles.root.state, "containerKeyPublicKey", "forged");
  expect(decodeContainerWriterProjection(forged)?.path).toEqual([stored]);
});

test("a projection derived from a decoded one answers for it", () => {
  const wire = encodeContainerWriterProjection(
    containerProjection(),
    new Set(["root"]),
  );
  const root = toServedAccessManifestBundle(bundle("root"));
  const held = new Map([["root", root]]);
  const decoded = decodeContainerWriterProjection(jsonRoundTrip(wire), held);
  if (!decoded) throw new Error("projection did not decode");
  expect(heldBundlesUsedBy(decoded)).toEqual([root]);
  const sliced = deriveDecodedProjection(decoded, {
    ...decoded,
    path: decoded.path.slice(0, 1),
  });
  // Another projection built from the same decoded one, held elsewhere.
  const intermediate = deriveDecodedProjection(decoded, { ...decoded });
  const pathOfSlice = deriveDecodedProjection(sliced, { ...sliced });
  expect(heldBundlesUsedBy(pathOfSlice)).toEqual([root]);
  // Refusing any derived projection refuses the decoded one a cache holds
  // and every other projection built from it.
  rejectDecodedProjection(pathOfSlice);
  expect(isRejectedDecodedProjection(decoded)).toBe(true);
  expect(isRejectedDecodedProjection(intermediate)).toBe(true);
});

test("refusing a projection refuses others rebuilt from the same held bytes", () => {
  const wire = encodeContainerWriterProjection(
    containerProjection(),
    new Set(["root"]),
  );
  // Bytes no other test in this file refuses.
  const root = bundle("root");
  const held = toServedAccessManifestBundle({
    ...root,
    event: { ...root.event, eventHash: "shared-held-bytes" },
  });
  const decode = () =>
    decodeContainerWriterProjection(
      jsonRoundTrip(wire),
      new Map([["root", structuredClone(held)]]),
    );
  // Two reads, each with its own copy of the same held bundle.
  const first = decode();
  const second = decode();
  if (!first || !second) throw new Error("projection did not decode");
  expect(isRejectedDecodedProjection(second)).toBe(false);
  rejectDecodedProjection(first);
  expect(isRejectedDecodedProjection(second)).toBe(true);
  // Once a read verifies with those bytes again, others may reuse them.
  const third = decode();
  if (!third) throw new Error("projection did not decode");
  acceptDecodedProjection(third);
  expect(isRejectedDecodedProjection(decode())).toBe(false);
});
