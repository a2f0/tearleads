import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/container-access-test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { openPrincipalPolicyBundleReader } from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import { createProjectionCheckpointContext } from "../checkpoints/checkpointContext";
import { verifyContainerManifestBundle } from "./containerManifestVerification";
import { readSignedContainerParentReference } from "./containerSignedParentReference";

function bundle(
  manifestHash: string,
  previousManifestHash: string | null,
  body: { readonly eventType: string } & Record<string, unknown>,
): AccessManifestBundleWireResponse {
  return {
    event: {
      body,
      event: { eventType: body.eventType, previousManifestHash },
      eventHash: `event-${manifestHash}`,
    },
    manifest: {},
    manifestHash,
    // The decoded state is never read for the pin.
    state: { parentContainerId: "served", parentManifestHash: "served" },
  };
}

const chain = [
  bundle("create", null, {
    eventType: "container.create",
    parentContainerId: "parent",
    parentManifestHash: "parent-1",
  }),
  bundle("grant", "create", { eventType: "container.grant" }),
  bundle("rekey", "grant", {
    eventType: "container.rekey",
    parentManifestHash: "parent-2",
  }),
  bundle("recite", "rekey", { eventType: "container.recite" }),
  bundle("move", "recite", {
    eventType: "container.move",
    parentContainerId: "other-parent",
    parentManifestHash: "other-1",
  }),
  bundle("revoke", "move", {
    eventType: "container.revoke",
    parentManifestHash: "other-2",
  }),
];

function pinOf(
  head: string,
  bundles: readonly AccessManifestBundleWireResponse[] = chain,
  verified: ReadonlyMap<string, VerifiedContainerAccessManifest> = new Map(),
) {
  const bundlesByHash = new Map(
    bundles.map((entry) => [entry.manifestHash, entry]),
  );
  const target = bundlesByHash.get(head);
  if (!target) throw new Error(`no ${head} bundle`);
  return readSignedContainerParentReference({
    bundle: target,
    bundlesByHash,
    label: "Test manifest",
    verifiedByHash: verified,
  });
}

test("each event pins the parent its signed bodies name", () => {
  expect(
    ["create", "grant", "rekey", "recite", "move", "revoke"].map((head) =>
      pinOf(head),
    ),
  ).toEqual([
    { parentContainerId: "parent", parentManifestHash: "parent-1" },
    { parentContainerId: "parent", parentManifestHash: "parent-1" },
    { parentContainerId: "parent", parentManifestHash: "parent-2" },
    { parentContainerId: "parent", parentManifestHash: "parent-2" },
    { parentContainerId: "other-parent", parentManifestHash: "other-1" },
    { parentContainerId: "other-parent", parentManifestHash: "other-2" },
  ]);
});

test("a verified predecessor answers with its derived state", async () => {
  const predecessor = await createContainerManifestFixture({
    containerId: "container-1",
    directGrants: [],
    parentContainerId: "derived",
    parentManifestHash: "d".repeat(64),
  });
  const [, grant, rekey, recite] = chain;
  if (!grant || !rekey || !recite) throw new Error("chain missing");
  expect(
    pinOf("recite", [rekey, recite], new Map([["grant", predecessor]])),
  ).toEqual({
    parentContainerId: "derived",
    parentManifestHash: "parent-2",
  });
});

test("a missing predecessor or a cycle is refused before verification", () => {
  const [, grant, rekey] = chain;
  if (!grant || !rekey) throw new Error("chain missing");
  expect(() => pinOf("rekey", [grant, rekey])).toThrow(
    expect.objectContaining({ code: "missing_dependency" }),
  );
  const looped = bundle("grant", "rekey", { eventType: "container.grant" });
  expect(() => pinOf("rekey", [looped, rekey])).toThrow(
    expect.objectContaining({ code: "object_mismatch" }),
  );
});

test("parent pins that cycle are refused before any verification", async () => {
  const pinned = (hash: string, parentHash: string) =>
    bundle(hash, null, {
      eventType: "container.create",
      parentContainerId: `container-of-${parentHash}`,
      parentManifestHash: parentHash,
    });
  const bundles = [pinned("a", "b"), pinned("b", "a")];
  const [first] = bundles;
  if (!first) throw new Error("cycle fixture missing");
  const database = await createTestExecSql("parent-pin-cycle");
  try {
    await expect(
      verifyContainerManifestBundle({
        bundle: first,
        bundlesByHash: new Map(
          bundles.map((entry) => [entry.manifestHash, entry]),
        ),
        checkpointContext: createProjectionCheckpointContext({
          execSql: database.execSql,
          openPrincipalPolicyBundleReader,
        }),
        enforceLocalCheckpoint: false,
        label: "Cyclic manifest",
        parentPath: [],
        principalPolicyCache: new Map(),
        resolveUserKey: async () => {
          throw new Error("no signer is resolved for a cycle");
        },
        verifiedByHash: new Map(),
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    database.close();
  }
});
