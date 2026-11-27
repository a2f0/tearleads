import { expect, test } from "bun:test";
import { emptyHttpTraffic } from "../inProcess/httpCounterProxy";
import type { ExportedKeyPackage } from "../inProcess/multiUserDevice";
import type { ProbeActor } from "../inProcess/multiUserWorld";
import { emptyTraffic } from "../inProcess/postgresWire";
import {
  type RotationPhaseMeasurement,
  type RotationTierDevice,
  type RotationTierWorld,
  runRotationTierWithWorld,
} from "./runTier";

interface FakeWorldOptions {
  readonly failShrinkRotation?: boolean;
  readonly failFreshText?: boolean;
  readonly throwInPhase?: "group-share" | "direct-revoke";
}

function createFakeRotationWorld(options: FakeWorldOptions = {}) {
  const events: string[] = [];
  const folderParents = new Map<string, string>();
  const docFolder = new Map<string, string>();
  const docText = new Map<string, string>();
  const epochs = new Map<string, number>();
  let nextFolder = 0;
  let nextDoc = 0;
  let disposed = false;

  const makeDevice = (label: string): RotationTierDevice => ({
    localSql: () => ({ calls: 5, durationMs: 2 }),
    captureSqlWindow: () => ({
      finish: () => ({
        top: [],
        mutations: 1,
        maxMutationHoldMs: 0.5,
        maxStatementsPerMutation: 2,
      }),
    }),
    holdFolder: async (folderId) => {
      events.push(`${label}:hold:${folderId}`);
    },
    readDocument: async (documentId) => ({
      getSnapshot: () => ({
        text: options.failFreshText
          ? "wrong text"
          : (docText.get(documentId) ?? ""),
      }),
    }),
  });

  const devicesByActor = new Map<string, RotationTierDevice>();
  const world: RotationTierWorld<RotationTierDevice> = {
    async register(name) {
      devicesByActor.set(name, makeDevice(name));
      return {
        name,
        userId: `user-${name}`,
        keyPackage: {} as ExportedKeyPackage,
        devices: [],
      };
    },
    async newDevice(actor) {
      events.push(`newDevice:${actor.name}`);
      return makeDevice(`${actor.name}-fresh`);
    },
    rootId: (actor) => `root-${actor.name}`,
    primaryDevice(actor) {
      const device = devicesByActor.get(actor.name);
      if (!device) throw new Error(`Missing device for ${actor.name}`);
      return device;
    },
    async addToOrganization(owner, member) {
      events.push(`addToOrg:${owner.name}:${member.name}`);
    },
    async adminsGroup() {
      return { id: "grp-admins", name: "Admins" };
    },
    async createFolder(_actor, parentId, name) {
      nextFolder += 1;
      const id = `f-${nextFolder}-${name}`;
      folderParents.set(id, parentId);
      epochs.set(id, 1);
      return id;
    },
    async moveFolder(_actor, folderId, newParentId) {
      events.push(`move:${folderId}->${newParentId}`);
      folderParents.set(folderId, newParentId);
      epochs.set(folderId, (epochs.get(folderId) ?? 1) + 1);
    },
    async createDocument(_actor, folderId, text) {
      nextDoc += 1;
      const documentId = `doc-${nextDoc}`;
      docFolder.set(documentId, folderId);
      docText.set(documentId, text);
      return { documentId, containerIds: [folderId] };
    },
    async editDocument(_actor, document, text) {
      docText.set(document.documentId, text);
    },
    async createGroup(_actor, name) {
      return { id: `grp-${name}`, name };
    },
    async addToGroup(_actor, group, member) {
      events.push(`addToGroup:${group.name}:${member.name}`);
    },
    async removeFromGroup(_actor, group, member) {
      events.push(`removeFromGroup:${group.name}:${member.name}`);
      if (!options.failShrinkRotation) {
        const top = [...epochs.keys()][0];
        if (top) epochs.set(top, (epochs.get(top) ?? 1) + 1);
      }
    },
    async shareWithGroup(_actor, folderId, group) {
      if (options.throwInPhase === "group-share") {
        throw new Error("share boom");
      }
      events.push(`shareGroup:${folderId}:${group.name}`);
    },
    async shareWithUser(_actor, folderId, recipient, _level, shareOptions) {
      events.push(
        `shareUser:${folderId}:${recipient.name}:skip=${Boolean(shareOptions?.skipLinkAdmit)}`,
      );
    },
    async revokeGrant(_actor, folderId, subject) {
      if (options.throwInPhase === "direct-revoke") {
        throw new Error("revoke boom");
      }
      events.push(`revoke:${folderId}:${subject.kind}`);
      epochs.set(folderId, (epochs.get(folderId) ?? 1) + 1);
    },
    async keyEpoch(_actor, folderId) {
      return epochs.get(folderId) ?? 1;
    },
    dispose() {
      disposed = true;
    },
  };
  return {
    world,
    events,
    docFolder,
    isDisposed: () => disposed,
  };
}

test("depth=2 places upperDoc strictly above bottomFolder and captures SQL attribution on fresh reader", async () => {
  const fake = createFakeRotationWorld();
  const measured: RotationPhaseMeasurement[] = [];

  await runRotationTierWithWorld(fake.world, {
    rotations: 2,
    depth: 2,
    sample: 1,
    http: emptyHttpTraffic,
    traffic: emptyTraffic,
    measured: async (m) => {
      measured.push(m);
    },
  });

  expect(fake.isDisposed()).toBe(true);
  // upperDoc must stay in level-1 while lowerDoc is in level-2 (moved by subtree-move).
  expect(fake.docFolder.get("doc-1")).toBe("f-1-level-1");
  expect(fake.docFolder.get("doc-2")).toBe("f-2-level-2");
  expect(measured.map((m) => m.phase)).toEqual([
    "group-share",
    "group-shrink",
    "stale-writer-repair",
    "direct-revoke",
    "grantee-subtree-repair",
    "subtree-move",
    "fresh-reader-hydration",
    "roster-vouched-share",
  ]);
  const fresh = measured.find((m) => m.phase === "fresh-reader-hydration");
  expect(fresh?.localSql?.attribution).toBeDefined();
  expect(fake.events).toContain("shareUser:f-3-archive:frank:skip=true");
});

test("depth=1 skips grantee-subtree-repair and disposes world on failures", async () => {
  const depth1 = createFakeRotationWorld();
  const measured: RotationPhaseMeasurement[] = [];
  await runRotationTierWithWorld(depth1.world, {
    rotations: 1,
    depth: 1,
    sample: 1,
    http: emptyHttpTraffic,
    traffic: emptyTraffic,
    measured: async (m) => {
      measured.push(m);
    },
  });
  expect(measured.map((m) => m.phase)).not.toContain("grantee-subtree-repair");
  expect(depth1.isDisposed()).toBe(true);

  const staleShrink = createFakeRotationWorld({ failShrinkRotation: true });
  await expect(
    runRotationTierWithWorld(staleShrink.world, {
      rotations: 1,
      depth: 2,
      sample: 1,
      http: emptyHttpTraffic,
      traffic: emptyTraffic,
      measured: async () => undefined,
    }),
  ).rejects.toThrow(/Expected group-shrink to rotate/u);
  expect(staleShrink.isDisposed()).toBe(true);

  const badText = createFakeRotationWorld({ failFreshText: true });
  await expect(
    runRotationTierWithWorld(badText.world, {
      rotations: 1,
      depth: 2,
      sample: 1,
      http: emptyHttpTraffic,
      traffic: emptyTraffic,
      measured: async () => undefined,
    }),
  ).rejects.toThrow(/Fresh reader text mismatch/u);
  expect(badText.isDisposed()).toBe(true);
});

test("satisfies ProbeActor type contract without runtime side effects", () => {
  const actor: ProbeActor = {
    name: "test",
    userId: "u-1",
    keyPackage: {} as ExportedKeyPackage,
    devices: [],
  };
  expect(actor.userId).toBe("u-1");
});
