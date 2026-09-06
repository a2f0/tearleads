import { expect, test } from "bun:test";
import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  createNativeTestExecSql,
  createNoBrickTraceRecorder,
  type NoBrickOutcome,
  type NoBrickProjection,
  type NoBrickTraceRecorder,
  persistNoBrickTrace,
} from "@tearleads/test-utils";
import {
  createScenario,
  grantBy,
  type Signer,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";

/**
 * Projects runs of the real container-path verifier onto the NoBrickedDevice
 * model's action vocabulary. The honest root chain is the model's authority,
 * the honest child chain its dependent, and Mallory its late signer. Every
 * verification below is made by `verifyContainerManifestPath` against this
 * device's persisted checkpoints, then recorded with the outcome it
 * produced; scripts/checkNoBrickProjection.ts replays the recorded trace
 * through TLC, so a sequence or an outcome the model's rules disagree with
 * fails `check:fast`. Each scenario is one device; the model's other devices
 * are the writers the honest API accepts commits from.
 */

const DEVICE = "d1";

type Scenario = Awaited<ReturnType<typeof createScenario>>;
type ExecSql = ReturnType<typeof createNativeTestExecSql>["execSql"];

interface World {
  readonly scenario: Scenario;
  readonly recorder: NoBrickTraceRecorder;
  /** Honest root chain, index = epoch - 1. */
  readonly authority: VerifiedContainerAccessManifest[];
  /** Honest child chain, index = epoch - 1. */
  readonly dependent: VerifiedContainerAccessManifest[];
  /** Heads the honest API never committed, served by a dishonest server. */
  readonly forged: VerifiedContainerAccessManifest[];
  /** Each grant names a fresh subject: a repeated subject is a duplicate grant. */
  nextSubject: number;
}

function freshSubject(world: World): string {
  world.nextSubject += 1;
  return `peer-${world.nextSubject}`;
}

interface Device {
  readonly execSql: ExecSql;
  /** Highest accepted epoch per container id; absent with no history. */
  readonly checkpoints: Map<string, number>;
}

function createWorld(
  scenario: Scenario,
  recorder: NoBrickTraceRecorder,
): World {
  return {
    scenario,
    recorder,
    authority: [scenario.root1],
    dependent: [scenario.child1],
    forged: [],
    nextSubject: 0,
  };
}

function served(world: World): VerifiedContainerAccessManifest[] {
  return [...world.authority, ...world.dependent, ...world.forged];
}

function byHash(
  manifests: readonly VerifiedContainerAccessManifest[],
  hash: string | null,
): VerifiedContainerAccessManifest | undefined {
  return manifests.find((manifest) => manifest.manifestHash === hash);
}

/** The honest version through which a served head's chain is the honest one. */
function honestPrefixOf(
  world: World,
  head: VerifiedContainerAccessManifest,
): number {
  let current = head;
  while (!byHash(world.dependent, current.manifestHash)) {
    const previous = byHash(served(world), current.state.previousManifestHash);
    if (!previous) {
      throw new Error("a forged head must extend a served predecessor");
    }
    current = previous;
  }
  return current.state.epoch;
}

function projectionOf(
  world: World,
  root: VerifiedContainerAccessManifest,
  head: VerifiedContainerAccessManifest,
): NoBrickProjection {
  const cited = head.event.event.dependencyManifestHashes
    .map((hash) => byHash(world.authority, hash)?.state.epoch)
    .find((epoch) => epoch !== undefined);
  if (cited === undefined) {
    throw new Error("a served head must cite an honest authority head");
  }
  return {
    head: head.state.epoch,
    honestPrefix: honestPrefixOf(world, head),
    cited,
    late: head.event.event.signerUserId === world.scenario.mallory.userId,
    authority: root.state.epoch,
  };
}

async function acceptCheckpoints(
  device: Device,
  verifiedPath: readonly VerifiedContainerAccessManifest[],
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>,
): Promise<void> {
  const access = verifiedPath.map((head) => {
    const containerId = head.state.containerId;
    const floor = device.checkpoints.get(containerId) ?? 0;
    const predecessors = [...verifiedByHash.values()]
      .filter(
        (manifest) =>
          manifest.state.containerId === containerId &&
          manifest.state.epoch > floor &&
          manifest.state.epoch < head.state.epoch,
      )
      .sort((left, right) => left.state.epoch - right.state.epoch);
    return { head, predecessors };
  });
  await advanceKeyingCheckpointsAtomically({
    access,
    execSql: device.execSql,
    policies: [],
  });
  for (const head of verifiedPath) {
    device.checkpoints.set(head.state.containerId, head.state.epoch);
  }
}

/** Verify a served path as this device and persist the result exactly as production does. */
async function verifyServed(
  world: World,
  device: Device,
  path: readonly [
    VerifiedContainerAccessManifest,
    VerifiedContainerAccessManifest,
  ],
): Promise<NoBrickOutcome> {
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  try {
    const verified = await verifyPath(world.scenario, device.execSql, {
      bundles: served(world),
      path,
      verifiedByHash,
    });
    await acceptCheckpoints(device, verified, verifiedByHash);
    return "accepted";
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      return "refused";
    }
    throw error;
  }
}

/** The device initially holds the first root and child heads, or nothing. */
async function createDevice(
  world: World,
  execSql: ExecSql,
  initialCheckpoint: 0 | 1,
): Promise<Device> {
  const device: Device = { execSql, checkpoints: new Map() };
  if (initialCheckpoint === 1) {
    const outcome = await verifyServed(world, device, [
      world.scenario.root1,
      world.scenario.child1,
    ]);
    if (outcome !== "accepted") {
      throw new Error("the initial heads must verify");
    }
  }
  return device;
}

/** The honest API commits a child head citing the current root head. */
async function commit(
  world: World,
  input: { readonly signer: Signer },
): Promise<VerifiedContainerAccessManifest> {
  const root = world.authority.at(-1);
  const previous = world.dependent.at(-1);
  if (!root || !previous) {
    throw new Error("chains are never empty");
  }
  const head = await grantBy({
    cited: [root.manifestHash, previous.manifestHash],
    previous,
    signer: input.signer,
    subjectId: freshSubject(world),
  });
  world.dependent.push(head);
  world.recorder.record({
    action: "CommitDependent",
    late: input.signer.userId === world.scenario.mallory.userId,
  });
  return head;
}

/** Alice's revoke of Mallory at the root, already signed by the scenario. */
function revoke(world: World): void {
  world.authority.push(world.scenario.root2);
  world.recorder.record({ action: "RevokeLateSigner" });
}

/** A head the API never committed, signed by whoever the server colludes with. */
async function forge(
  world: World,
  input: {
    readonly cited: readonly VerifiedContainerAccessManifest[];
    readonly previous: VerifiedContainerAccessManifest;
    readonly signer: Signer;
  },
): Promise<VerifiedContainerAccessManifest> {
  const head = await grantBy({
    cited: input.cited.map((manifest) => manifest.manifestHash),
    previous: input.previous,
    signer: input.signer,
    subjectId: freshSubject(world),
  });
  world.forged.push(head);
  return head;
}

async function honestSync(
  world: World,
  device: Device,
): Promise<NoBrickOutcome> {
  const root = world.authority.at(-1);
  const head = world.dependent.at(-1);
  if (!root || !head) {
    throw new Error("chains are never empty");
  }
  const outcome = await verifyServed(world, device, [root, head]);
  world.recorder.record({
    action: "HonestSync",
    device: DEVICE,
    observed: { outcome },
  });
  return outcome;
}

async function dishonestSync(
  world: World,
  device: Device,
  root: VerifiedContainerAccessManifest,
  head: VerifiedContainerAccessManifest,
): Promise<NoBrickOutcome> {
  const projection = projectionOf(world, root, head);
  const outcome = await verifyServed(world, device, [root, head]);
  world.recorder.record({
    action: "Verify",
    device: DEVICE,
    projection,
    observed: { outcome },
  });
  return outcome;
}

test("a late-delivered head is accepted, and rollback, a revoked signer, a fork, and the residual project onto the model", async () => {
  const scenario = await createScenario();
  const { close, execSql } = createNativeTestExecSql();
  try {
    const recorder = createNoBrickTraceRecorder("container-late-delivery", {
      [DEVICE]: 1,
    });
    const world = createWorld(scenario, recorder);
    const device = await createDevice(world, execSql, 1);

    // Mallory's last honest event, while root1 still granted her.
    const child2 = await commit(world, {
      signer: scenario.mallory,
    });
    revoke(world);
    // Delivered only now: the honest shape the currency rules refused.
    expect(await honestSync(world, device)).toBe("accepted");

    // The served root rolled back below this device's checkpoint.
    expect(await dishonestSync(world, device, scenario.root1, child2)).toBe(
      "refused",
    );
    // Mallory forging after her revocation, citing the head that revoked her.
    const forgedAtRoot2 = await forge(world, {
      cited: [scenario.root2, child2],
      previous: child2,
      signer: scenario.mallory,
    });
    expect(
      await dishonestSync(world, device, scenario.root2, forgedAtRoot2),
    ).toBe("refused");
    // A same-epoch fork of the head this device already holds, signed by
    // Mallory under the root that still granted her.
    const fork = await forge(world, {
      cited: [scenario.root1, scenario.child1],
      previous: scenario.child1,
      signer: scenario.mallory,
    });
    expect(await dishonestSync(world, device, scenario.root2, fork)).toBe(
      "refused",
    );
    // The documented residual: a forgery citing the head that still granted
    // Mallory, extending the honest chain. Accepted, and terminal for the
    // device in the model.
    const residual = await forge(world, {
      cited: [scenario.root1, child2],
      previous: child2,
      signer: scenario.mallory,
    });
    expect(await dishonestSync(world, device, scenario.root2, residual)).toBe(
      "accepted",
    );

    persistNoBrickTrace(recorder.trace());
  } finally {
    close();
  }
});

test("a chain whose middle entry cites an older root is accepted, and a regression and a stale served root are refused", async () => {
  const scenario = await createScenario();
  const { close, execSql } = createNativeTestExecSql();
  try {
    const recorder = createNoBrickTraceRecorder("container-late-chain", {
      [DEVICE]: 1,
    });
    const world = createWorld(scenario, recorder);
    const device = await createDevice(world, execSql, 1);

    await commit(world, {
      signer: scenario.mallory,
    });
    revoke(world);
    const child3 = await commit(world, {
      signer: scenario.alice,
    });
    // The #2173 shape: the chain above the checkpoint contains an entry
    // citing root1 although root2 is served as current.
    expect(await honestSync(world, device)).toBe("accepted");

    // A head citing an older root than its predecessor established.
    const regressed = await forge(world, {
      cited: [scenario.root1, child3],
      previous: child3,
      signer: scenario.mallory,
    });
    expect(await dishonestSync(world, device, scenario.root2, regressed)).toBe(
      "refused",
    );
    // A served root older than the one the head's signature proves exists.
    expect(await dishonestSync(world, device, scenario.root1, child3)).toBe(
      "refused",
    );

    persistNoBrickTrace(recorder.trace());
  } finally {
    close();
  }
});

test("a device with no history refuses a stale served root and accepts the current projection", async () => {
  const scenario = await createScenario();
  const { close, execSql } = createNativeTestExecSql();
  try {
    const recorder = createNoBrickTraceRecorder("container-fresh-device", {
      [DEVICE]: 0,
    });
    const world = createWorld(scenario, recorder);
    const device = await createDevice(world, execSql, 0);

    revoke(world);
    const child2 = await commit(world, {
      signer: scenario.alice,
    });
    // No checkpoint to roll back against, so only the citation refuses it.
    expect(await dishonestSync(world, device, scenario.root1, child2)).toBe(
      "refused",
    );
    expect(await honestSync(world, device)).toBe("accepted");

    persistNoBrickTrace(recorder.trace());
  } finally {
    close();
  }
});
