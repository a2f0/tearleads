import type { HttpWireTraffic } from "../inProcess/httpCounterProxy";
import {
  type MeasuredPhaseStats,
  measureProtocolPhase,
  type PhaseDeviceObserver,
} from "../inProcess/measurePhase";
import type { MultiUserDevice } from "../inProcess/multiUserDevice";
import {
  MultiUserWorld,
  type ProbeActor,
  type ProbeDocument,
  type ProbeGroup,
} from "../inProcess/multiUserWorld";
import type { PostgresTraffic } from "../inProcess/postgresWire";

export type RotationPhaseName =
  | "group-share"
  | "group-shrink"
  | "stale-writer-repair"
  | "direct-revoke"
  | "grantee-subtree-repair"
  | "subtree-move"
  | "fresh-reader-hydration"
  | "roster-vouched-share";

export interface RotationPhaseMeasurement extends MeasuredPhaseStats {
  readonly rotations: number;
  readonly depth: number;
  readonly sample: number;
  readonly phase: RotationPhaseName;
  /** Observed measured-folder key epoch after the phase, when applicable. */
  readonly folderKeyEpoch?: number;
}

/** Structural world interface so `runRotationTier` can be unit-tested cleanly. */
export interface RotationTierDevice extends PhaseDeviceObserver {
  readonly holdFolder: (folderId: string) => Promise<void>;
  readonly readDocument: (
    documentId: string,
    containerIds: readonly string[],
  ) => Promise<{
    readonly getSnapshot: () => { readonly text: string };
  } | null>;
}

export interface RotationTierWorld<
  TDevice extends RotationTierDevice = MultiUserDevice,
> {
  register(name: string): Promise<ProbeActor>;
  newDevice(actor: ProbeActor): Promise<TDevice>;
  rootId(actor: ProbeActor): string;
  primaryDevice(actor: ProbeActor): TDevice;
  addToOrganization(
    owner: ProbeActor,
    member: ProbeActor,
    device?: TDevice,
  ): Promise<void>;
  adminsGroup(owner: ProbeActor): Promise<ProbeGroup>;
  createFolder(
    actor: ProbeActor,
    parentId: string,
    name: string,
  ): Promise<string>;
  moveFolder(
    actor: ProbeActor,
    folderId: string,
    newParentId: string,
  ): Promise<void>;
  createDocument(
    actor: ProbeActor,
    folderId: string,
    text: string,
  ): Promise<ProbeDocument>;
  editDocument(
    actor: ProbeActor,
    document: ProbeDocument,
    text: string,
    device?: TDevice,
  ): Promise<void>;
  createGroup(actor: ProbeActor, name: string): Promise<ProbeGroup>;
  addToGroup(
    actor: ProbeActor,
    group: ProbeGroup,
    member: ProbeActor,
  ): Promise<void>;
  removeFromGroup(
    actor: ProbeActor,
    group: ProbeGroup,
    member: ProbeActor,
  ): Promise<void>;
  shareWithGroup(
    actor: ProbeActor,
    folderId: string,
    group: ProbeGroup,
    level: "read" | "write" | "admin",
  ): Promise<void>;
  shareWithUser(
    actor: ProbeActor,
    folderId: string,
    recipient: ProbeActor,
    level?: "read" | "write" | "admin",
    options?: {
      readonly device?: TDevice;
      readonly skipLinkAdmit?: boolean;
    },
  ): Promise<void>;
  revokeGrant(
    actor: ProbeActor,
    folderId: string,
    subject: { readonly kind: "user" | "group"; readonly id: string },
  ): Promise<void>;
  keyEpoch(actor: ProbeActor, folderId: string): Promise<number>;
  dispose(): void;
}

interface TierFixture<TDevice extends RotationTierDevice> {
  readonly world: RotationTierWorld<TDevice>;
  readonly alice: ProbeActor;
  readonly bob: ProbeActor;
  readonly carol: ProbeActor;
  readonly dave: ProbeActor;
  readonly erin: ProbeActor;
  readonly frank: ProbeActor;
  readonly chain: readonly string[];
  readonly archiveId: string;
  readonly upperDoc: ProbeDocument;
  readonly lowerDoc: ProbeDocument;
  readonly team: ProbeGroup;
}

async function setupTierFixture<TDevice extends RotationTierDevice>(
  world: RotationTierWorld<TDevice>,
  depth: number,
): Promise<TierFixture<TDevice>> {
  try {
    const alice = await world.register("alice");
    const bob = await world.register("bob");
    const carol = await world.register("carol");
    const dave = await world.register("dave");
    const erin = await world.register("erin");
    const frank = await world.register("frank");
    for (const member of [bob, carol, dave, erin]) {
      await world.addToOrganization(alice, member);
    }
    // Bob joins Admins and enrolls Frank, forming a 2-hop Alice -> Bob -> Frank
    // roster chain for the transitive roster-vouched-share phase.
    const admins = await world.adminsGroup(alice);
    await world.addToGroup(alice, admins, bob);
    await world.addToOrganization(bob, frank);

    const chain: string[] = [];
    let parentId = world.rootId(alice);
    for (let level = 1; level <= depth; level += 1) {
      parentId = await world.createFolder(alice, parentId, `level-${level}`);
      chain.push(parentId);
    }
    const archiveId = await world.createFolder(
      alice,
      world.rootId(alice),
      "archive",
    );
    // Keep `upperFolder` strictly above `bottomFolder` whenever depth >= 2 so
    // moving `bottomFolder` out from under the group does not cut off `upperDoc`.
    const upperFolder = chain.length >= 3 ? chain[1] : chain[0];
    const lowerFolder = chain.at(-1);
    if (!upperFolder || !lowerFolder) {
      throw new Error("Folder chain is empty.");
    }
    const upperDoc = await world.createDocument(alice, upperFolder, "upper v0");
    const lowerDoc = await world.createDocument(alice, lowerFolder, "lower v0");
    const team = await world.createGroup(alice, "Team");
    await world.addToGroup(alice, team, bob);
    return {
      world,
      alice,
      bob,
      carol,
      dave,
      erin,
      frank,
      chain,
      archiveId,
      upperDoc,
      lowerDoc,
      team,
    };
  } catch (error) {
    world.dispose();
    throw error;
  }
}

async function primeReadersAndChurn<TDevice extends RotationTierDevice>(
  fixture: TierFixture<TDevice>,
  rotations: number,
): Promise<void> {
  const {
    world,
    alice,
    bob,
    carol,
    dave,
    erin,
    chain,
    upperDoc,
    lowerDoc,
    team,
  } = fixture;
  const topFolder = chain[0];
  const bottomFolder = chain.at(-1);
  if (!topFolder || !bottomFolder) throw new Error("Missing chain folders.");
  if (chain.length >= 2) {
    await world.shareWithUser(alice, bottomFolder, dave, "write");
  }
  await world.shareWithUser(alice, topFolder, erin, "write");

  // Every active writer holds the pre-rotation path before churn begins.
  const expectPrimed = async (
    actor: ProbeActor,
    doc: ProbeDocument,
    expectedText: string,
  ): Promise<void> => {
    const store = await world
      .primaryDevice(actor)
      .readDocument(doc.documentId, doc.containerIds);
    if (store?.getSnapshot().text !== expectedText) {
      throw new Error(
        `Failed to prime ${actor.name} with ${JSON.stringify(expectedText)}; got ${JSON.stringify(store?.getSnapshot().text)}.`,
      );
    }
  };
  await expectPrimed(bob, upperDoc, "upper v0");
  await expectPrimed(erin, upperDoc, "upper v0");
  if (chain.length >= 2) {
    await expectPrimed(dave, lowerDoc, "lower v0");
  }

  for (let round = 1; round < rotations; round += 1) {
    await world.addToGroup(alice, team, carol);
    await world.editDocument(carol, upperDoc, `round ${round} carol`);
    await world.removeFromGroup(alice, team, carol);
    await world.editDocument(bob, upperDoc, `round ${round} bob`);
  }
  await world.addToGroup(alice, team, carol);
  await world.editDocument(carol, upperDoc, `round ${rotations} carol`);
}

interface PhaseRecorder {
  record<T>(
    phase: RotationPhaseName,
    device: () => RotationTierDevice | null,
    run: () => Promise<T>,
    epochFolder?: string,
  ): Promise<T>;
}

async function runPostShrinkPhases<TDevice extends RotationTierDevice>(
  fixture: TierFixture<TDevice>,
  rotations: number,
  depth: number,
  recorder: PhaseRecorder,
): Promise<void> {
  const {
    world,
    alice,
    bob,
    dave,
    erin,
    frank,
    chain,
    archiveId,
    upperDoc,
    lowerDoc,
  } = fixture;
  const topFolder = chain[0];
  const bottomFolder = chain.at(-1);
  if (!topFolder || !bottomFolder) throw new Error("Folder chain is empty.");

  const latestUpper = `stale erin after ${rotations} rotations`;
  await recorder.record(
    "stale-writer-repair",
    () => world.primaryDevice(erin),
    () => world.editDocument(erin, upperDoc, latestUpper),
  );

  await recorder.record(
    "direct-revoke",
    () => world.primaryDevice(alice),
    () =>
      world.revokeGrant(alice, topFolder, { kind: "user", id: erin.userId }),
    topFolder,
  );

  if (depth >= 2) {
    await recorder.record(
      "grantee-subtree-repair",
      () => world.primaryDevice(dave),
      () => world.editDocument(dave, lowerDoc, "dave repaired subtree"),
      bottomFolder,
    );
  }

  await recorder.record(
    "subtree-move",
    () => world.primaryDevice(alice),
    () => world.moveFolder(alice, bottomFolder, archiveId),
    bottomFolder,
  );

  // Log in the fresh empty-DB device first so `measureProtocolPhase` opens its
  // SQLite attribution window across cold discovery, keyring walk, and decrypt.
  const freshReader = await world.newDevice(bob);
  await recorder.record(
    "fresh-reader-hydration",
    () => freshReader,
    async () => {
      const store = await freshReader.readDocument(
        upperDoc.documentId,
        upperDoc.containerIds,
      );
      if (store?.getSnapshot().text !== latestUpper) {
        throw new Error(
          `Fresh reader text mismatch: got ${JSON.stringify(store?.getSnapshot().text)}`,
        );
      }
    },
  );

  // Fresh Alice install has only self-anchor; share archive with Frank via
  // Alice -> Bob -> Frank roster vouching without importing Frank's link.
  const freshAdmin = await world.newDevice(alice);
  await freshAdmin.holdFolder(archiveId);
  await recorder.record(
    "roster-vouched-share",
    () => freshAdmin,
    () =>
      world.shareWithUser(alice, archiveId, frank, "write", {
        device: freshAdmin,
        skipLinkAdmit: true,
      }),
  );
}

/**
 * Runs all key-rotation, shrink-carry, revocation, stale-writer repair,
 * fresh-device keyring hydration, and roster-vouched share phases against the
 * supplied world coordinator.
 */
export async function runRotationTierWithWorld<
  TDevice extends RotationTierDevice,
>(
  world: RotationTierWorld<TDevice>,
  input: {
    readonly rotations: number;
    readonly depth: number;
    readonly sample: number;
    readonly http: () => HttpWireTraffic;
    readonly traffic: () => PostgresTraffic;
    readonly measured: (measurement: RotationPhaseMeasurement) => Promise<void>;
  },
): Promise<void> {
  const fixture = await setupTierFixture(world, input.depth);
  const { alice, carol, chain, team } = fixture;
  const topFolder = chain[0];
  if (!topFolder) {
    world.dispose();
    throw new Error("Folder chain is empty.");
  }

  const recorder: PhaseRecorder = {
    async record(phase, device, run, epochFolder) {
      const { value, stats } = await measureProtocolPhase({
        http: input.http,
        traffic: input.traffic,
        device,
        run,
      });
      const folderKeyEpoch = epochFolder
        ? await world.keyEpoch(alice, epochFolder)
        : undefined;
      await input.measured({
        rotations: input.rotations,
        depth: input.depth,
        sample: input.sample,
        phase,
        ...stats,
        ...(folderKeyEpoch !== undefined ? { folderKeyEpoch } : {}),
      });
      return value;
    },
  };

  try {
    await recorder.record(
      "group-share",
      () => world.primaryDevice(alice),
      () => world.shareWithGroup(alice, topFolder, team, "write"),
      topFolder,
    );

    await primeReadersAndChurn(fixture, input.rotations);
    const epochBeforeShrink = await world.keyEpoch(alice, topFolder);

    await recorder.record(
      "group-shrink",
      () => world.primaryDevice(alice),
      () => world.removeFromGroup(alice, team, carol),
      topFolder,
    );
    if ((await world.keyEpoch(alice, topFolder)) <= epochBeforeShrink) {
      throw new Error("Expected group-shrink to rotate top folder key epoch.");
    }

    await runPostShrinkPhases(fixture, input.rotations, input.depth, recorder);
  } finally {
    world.dispose();
  }
}

/**
 * Runs all rotation phases for one `(rotations, depth, sample)` tier using a
 * fresh `MultiUserWorld`.
 */
export async function runRotationTier(input: {
  readonly apiBaseUrl: string;
  readonly trustOrigin: string;
  readonly rotations: number;
  readonly depth: number;
  readonly sample: number;
  readonly http: () => HttpWireTraffic;
  readonly traffic: () => PostgresTraffic;
  readonly measured: (measurement: RotationPhaseMeasurement) => Promise<void>;
}): Promise<void> {
  const world = new MultiUserWorld(input.apiBaseUrl, input.trustOrigin);
  await runRotationTierWithWorld(world, input);
}
