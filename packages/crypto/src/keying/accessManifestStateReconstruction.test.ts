import { describe, expect, test } from "bun:test";
import {
  MAX_RECONSTRUCTED_STATE_ENTRIES,
  reconstructServedAccessManifestStates,
  type ServedAccessManifestBundle,
} from "./accessManifestStateReconstruction";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";

const ORGANIZATION = "organization-1";
const PUBLIC_KEY_1 = containerWrappingPublicKeyForTest("epoch-1");
const PUBLIC_KEY_2 = containerWrappingPublicKeyForTest("epoch-2");

function hash(label: string): string {
  return label
    .padEnd(64, "0")
    .replace(/[^0-9a-f]/gu, "a")
    .slice(0, 64);
}

function served(input: {
  readonly body: Record<string, unknown>;
  readonly eventType: string;
  readonly manifestHash: string;
  readonly objectId?: string;
  readonly objectKind?: "container" | "document";
  readonly previousManifestHash: string | null;
}): ServedAccessManifestBundle {
  return {
    manifestHash: input.manifestHash,
    event: {
      body: input.body,
      eventHash: hash(`e${input.manifestHash}`),
      event: {
        version: 1,
        eventId: `event-${input.manifestHash}`,
        eventType: input.eventType,
        objectKind: input.objectKind ?? "container",
        objectId: input.objectId ?? "container-1",
        organizationId: ORGANIZATION,
        previousManifestHash: input.previousManifestHash,
        dependencyManifestHashes: [],
        bodyHash: hash("b"),
        signerUserId: "user-1",
        signerDeviceId: "device-1",
        signerKeyFingerprint: hash("f"),
        signedAt: "2026-11-17T00:00:00.000Z",
        signature: "signature",
      },
    },
  };
}

const ADMIN = {
  accessLevel: "admin",
  subjectId: "user-1",
  subjectType: "user",
} as const;
const READER = {
  accessLevel: "read",
  subjectId: "user-2",
  subjectType: "user",
} as const;

function containerChain(): ServedAccessManifestBundle[] {
  return [
    served({
      manifestHash: hash("1"),
      eventType: "container.create",
      previousManifestHash: null,
      body: {
        eventType: "container.create",
        parentContainerId: null,
        parentManifestHash: null,
        metadataDocumentId: "metadata-1",
        systemSlot: null,
        containerKeyEpochId: "epoch-1",
        containerKeyPublicKey: PUBLIC_KEY_1,
        directGrants: [ADMIN],
        referencedPrincipalHeads: [],
      },
    }),
    served({
      manifestHash: hash("2"),
      eventType: "container.grant",
      previousManifestHash: hash("1"),
      body: {
        eventType: "container.grant",
        containerKeyEpochId: "epoch-1",
        containerKeyPublicKey: PUBLIC_KEY_1,
        grant: READER,
        referencedPrincipalHead: null,
      },
    }),
    served({
      manifestHash: hash("3"),
      eventType: "container.revoke",
      previousManifestHash: hash("2"),
      body: {
        eventType: "container.revoke",
        parentManifestHash: null,
        containerKeyEpochId: "epoch-2",
        containerKeyPublicKey: PUBLIC_KEY_2,
        keyringHash: hash("k"),
        predecessorBridgeHash: hash("p"),
        subjectId: "user-2",
        subjectType: "user",
      },
    }),
  ];
}

function byHash(bundles: readonly ServedAccessManifestBundle[]) {
  return new Map(bundles.map((bundle) => [bundle.manifestHash, bundle]));
}

describe("reconstructServedAccessManifestStates", () => {
  test("folds container bodies along the served chain", () => {
    const states = reconstructServedAccessManifestStates(
      byHash(containerChain().reverse()),
    );
    expect(states.get(hash("3"))).toEqual({
      version: 1,
      containerId: "container-1",
      organizationId: ORGANIZATION,
      epoch: 3,
      previousManifestHash: hash("2"),
      eventHash: hash(`e${hash("3")}`),
      parentContainerId: null,
      parentManifestHash: null,
      metadataDocumentId: "metadata-1",
      systemSlot: null,
      containerKeyEpochId: "epoch-2",
      containerKeyPublicKey: PUBLIC_KEY_2,
      directGrants: [ADMIN],
      referencedPrincipalHeads: [],
    });
    expect(states.get(hash("2"))).toMatchObject({
      epoch: 2,
      directGrants: [ADMIN, READER],
    });
  });

  test("folds document link and unlink bodies", () => {
    const link = (manifestHash: string, previous: string | null, id: string) =>
      served({
        manifestHash,
        eventType: "document.link",
        objectKind: "document",
        objectId: "document-1",
        previousManifestHash: previous,
        body: {
          eventType: "document.link",
          blobRewraps: [],
          containerId: id,
          containerManifestHash: hash("c"),
        },
      });
    const states = reconstructServedAccessManifestStates(
      byHash([
        link(hash("4"), null, "container-a"),
        link(hash("5"), hash("4"), "container-b"),
        served({
          manifestHash: hash("6"),
          eventType: "document.unlink",
          objectKind: "document",
          objectId: "document-1",
          previousManifestHash: hash("5"),
          body: {
            eventType: "document.unlink",
            blobRewraps: [],
            containerId: "container-a",
            containerManifestHash: hash("c"),
          },
        }),
      ]),
    );
    expect(states.get(hash("5"))).toMatchObject({
      epoch: 2,
      linkedContainerIds: ["container-a", "container-b"],
    });
    expect(states.get(hash("6"))).toEqual({
      version: 1,
      documentId: "document-1",
      organizationId: ORGANIZATION,
      epoch: 3,
      previousManifestHash: hash("5"),
      eventHash: hash(`e${hash("6")}`),
      linkedContainerIds: ["container-b"],
    });
  });

  test("a bundle without its served chain gets no state", () => {
    const [create, grant, revoke] = containerChain();
    if (!create || !grant || !revoke) throw new Error("chain missing");
    const states = reconstructServedAccessManifestStates(
      byHash([create, revoke]),
    );
    expect(states.get(hash("1"))).toMatchObject({ epoch: 1 });
    expect(states.get(hash("3"))).toBeNull();
  });

  test("an unparseable body breaks its own state and its successors'", () => {
    const [create, grant, revoke] = containerChain();
    if (!create || !grant || !revoke) throw new Error("chain missing");
    const broken = {
      ...grant,
      event: { ...Object(grant.event), body: { eventType: "container.grant" } },
    };
    const states = reconstructServedAccessManifestStates(
      byHash([revoke, broken, create]),
    );
    expect(states.get(hash("1"))).toMatchObject({ epoch: 1 });
    expect(states.get(hash("2"))).toBeNull();
    expect(states.get(hash("3"))).toBeNull();
  });

  test("a predecessor cycle gets no state", () => {
    const [, grant, revoke] = containerChain();
    if (!grant || !revoke) throw new Error("chain missing");
    const looped = served({
      manifestHash: hash("2"),
      eventType: "container.grant",
      previousManifestHash: hash("3"),
      body: Object(Object(grant.event).body),
    });
    const states = reconstructServedAccessManifestStates(
      byHash([looped, revoke]),
    );
    expect(states.get(hash("2"))).toBeNull();
    expect(states.get(hash("3"))).toBeNull();
  });

  test("a predecessor of another object kind gets no state", () => {
    const [create] = containerChain();
    if (!create) throw new Error("chain missing");
    const states = reconstructServedAccessManifestStates(
      byHash([
        create,
        served({
          manifestHash: hash("7"),
          eventType: "document.unlink",
          objectKind: "document",
          objectId: "document-1",
          previousManifestHash: hash("1"),
          body: {
            eventType: "document.unlink",
            blobRewraps: [],
            containerId: "container-1",
            containerManifestHash: hash("c"),
          },
        }),
      ]),
    );
    expect(states.get(hash("7"))).toBeNull();
  });
  test("a successor naming another object gets no state", () => {
    const [create, grant] = containerChain();
    if (!create || !grant) throw new Error("chain missing");
    const foreign = served({
      manifestHash: hash("2"),
      eventType: "container.grant",
      objectId: "container-2",
      previousManifestHash: hash("1"),
      body: Object(Object(grant.event).body),
    });
    const states = reconstructServedAccessManifestStates(
      byHash([create, foreign]),
    );
    expect(states.get(hash("1"))).toMatchObject({ epoch: 1 });
    expect(states.get(hash("2"))).toBeNull();
  });

  test("states past the entry budget are not rebuilt", () => {
    const [create] = containerChain();
    if (!create) throw new Error("chain missing");
    const chain = [create];
    // Each grant state repeats every earlier grant: n grants hold about
    // n * n / 2 entries in all, so this chain crosses the budget.
    const grants =
      Math.ceil(Math.sqrt(2 * MAX_RECONSTRUCTED_STATE_ENTRIES)) + 2;
    for (let index = 0; index < grants; index += 1) {
      chain.push(
        served({
          manifestHash: index.toString(16).padStart(64, "0"),
          eventType: "container.grant",
          previousManifestHash: chain.at(-1)?.manifestHash ?? null,
          body: {
            eventType: "container.grant",
            containerKeyEpochId: "epoch-1",
            containerKeyPublicKey: PUBLIC_KEY_1,
            grant: { ...READER, subjectId: `user-${index}` },
            referencedPrincipalHead: null,
          },
        }),
      );
    }
    const states = reconstructServedAccessManifestStates(byHash(chain));
    expect(states.get(hash("1"))).toMatchObject({ epoch: 1 });
    expect(states.get(chain.at(-1)?.manifestHash ?? "")).toBeNull();
  });
});
