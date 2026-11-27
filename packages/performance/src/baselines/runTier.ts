import type {
  HttpWireTraffic,
  RequestGate,
} from "../inProcess/httpCounterProxy";
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
} from "../inProcess/multiUserWorld";
import type { PostgresTraffic } from "../inProcess/postgresWire";
import { generateIncompressibleChunks } from "./largeText";

export type BaselinePhaseName =
  | "seed-history"
  | "first-unlink-rotate"
  | "fresh-reader-sync"
  | "second-unlink-rotate";

export type BaselineMode = "inline" | "staged";

export interface BaselinePhaseMeasurement extends MeasuredPhaseStats {
  readonly sizeMiB: number;
  readonly chunkMiB: number;
  readonly race: boolean;
  readonly sample: number;
  readonly phase: BaselinePhaseName;
  /** Whether a rotation unlink used `/baseline-stages` or inline segments. */
  readonly baselineMode?: BaselineMode;
  /** Count of `PUT .../baseline-stages/:stageId/segments/:index` uploads. */
  readonly stagedSegments?: number;
  /** Count of `GET .../baseline-stages/:stageId` stage resumes after 409. */
  readonly stageResumes?: number;
}

/** Structural device contract so `runBaselineTierWithWorld` is cleanly testable. */
export interface BaselineTierDevice extends PhaseDeviceObserver {
  readonly readDocument: (
    documentId: string,
    containerIds: readonly string[],
  ) => Promise<{
    readonly getSnapshot: () => { readonly text: string };
  } | null>;
  readonly readDocumentUntilText: (
    documentId: string,
    containerIds: readonly string[],
    expectedText: string,
  ) => Promise<{ readonly getSnapshot: () => { readonly text: string } }>;
}

export interface BaselineTierWorld<
  TDevice extends BaselineTierDevice = MultiUserDevice,
> {
  register(name: string): Promise<ProbeActor>;
  newDevice(actor: ProbeActor): Promise<TDevice>;
  rootId(actor: ProbeActor): string;
  primaryDevice(actor: ProbeActor): TDevice;
  addToOrganization(owner: ProbeActor, member: ProbeActor): Promise<void>;
  createFolder(
    actor: ProbeActor,
    parentId: string,
    name: string,
  ): Promise<string>;
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
  shareWithUser(
    actor: ProbeActor,
    folderId: string,
    recipient: ProbeActor,
    level?: "read" | "write" | "admin",
  ): Promise<void>;
  linkDocument(
    actor: ProbeActor,
    document: ProbeDocument,
    folderId: string,
  ): Promise<void>;
  unlinkDocument(
    actor: ProbeActor,
    document: ProbeDocument,
    folderId: string,
  ): Promise<void>;
  dispose(): void;
}

export type HoldBeforeRequest = (
  predicate: (request: {
    readonly method: string;
    readonly pathname: string;
  }) => boolean,
) => RequestGate;

const STAGE_CREATE_ROUTE = "POST /documents/:documentId/baseline-stages";
const STAGE_SEGMENT_ROUTE =
  "PUT /documents/:documentId/baseline-stages/:stageId/segments/:index";
const STAGE_RESUME_ROUTE =
  "GET /documents/:documentId/baseline-stages/:stageId";

function inspectRotationMetadata(http: HttpWireTraffic): {
  readonly baselineMode: BaselineMode;
  readonly stagedSegments: number;
  readonly stageResumes: number;
} {
  const createdStages = http.byRoute[STAGE_CREATE_ROUTE]?.count ?? 0;
  const stagedSegments = http.byRoute[STAGE_SEGMENT_ROUTE]?.count ?? 0;
  const stageResumes = http.byRoute[STAGE_RESUME_ROUTE]?.count ?? 0;
  return {
    baselineMode: createdStages > 0 || stagedSegments > 0 ? "staged" : "inline",
    stagedSegments,
    stageResumes,
  };
}

/**
 * Waits until either `gate` captures the target request or `work` settles
 * early (avoiding deadlocks if an unlink fails before hitting `POST /unlink`).
 */
async function waitForGateOrFinish(
  gate: RequestGate,
  work: Promise<unknown>,
): Promise<"held" | "finished"> {
  return Promise.race([
    gate.wait().then(() => "held" as const),
    work.then(
      () => "finished" as const,
      () => "finished" as const,
    ),
  ]);
}

async function runFirstUnlink<TDevice extends BaselineTierDevice>(input: {
  readonly world: BaselineTierWorld<TDevice>;
  readonly alice: ProbeActor;
  readonly bob: ProbeActor;
  readonly document: ProbeDocument;
  readonly handoffId: string;
  readonly baseText: string;
  readonly race: boolean;
  readonly holdBeforeRequest: HoldBeforeRequest;
}): Promise<string> {
  const {
    world,
    alice,
    bob,
    document,
    handoffId,
    baseText,
    race,
    holdBeforeRequest,
  } = input;
  if (!race) {
    await world.unlinkDocument(bob, document, handoffId);
    return baseText;
  }
  const racedText = `${baseText}alice wrote while bob rotated\n`;
  const gate = holdBeforeRequest(
    ({ method, pathname }) =>
      method === "POST" &&
      pathname.endsWith(`/documents/${document.documentId}/unlink`),
  );
  const unlinking = world.unlinkDocument(bob, document, handoffId);
  try {
    const outcome = await waitForGateOrFinish(gate, unlinking);
    if (outcome === "held") {
      try {
        await world.editDocument(alice, document, racedText);
      } finally {
        gate.release();
      }
    }
    await unlinking;
    return racedText;
  } finally {
    gate.cancel();
  }
}

interface BaselinePhaseRecorder {
  record<T>(
    phase: BaselinePhaseName,
    device: () => BaselineTierDevice | null,
    run: () => Promise<T>,
    options?: {
      readonly isRotation?: boolean;
      readonly requireConflict?: boolean;
    },
  ): Promise<T>;
}

function createBaselineRecorder(input: {
  readonly sizeMiB: number;
  readonly chunkMiB: number;
  readonly race: boolean;
  readonly sample: number;
  readonly http: () => HttpWireTraffic;
  readonly traffic: () => PostgresTraffic;
  readonly measured: (measurement: BaselinePhaseMeasurement) => Promise<void>;
}): BaselinePhaseRecorder {
  return {
    async record(phase, device, run, options = {}) {
      const { value, stats } = await measureProtocolPhase({
        http: input.http,
        traffic: input.traffic,
        device,
        run,
      });
      if (options.requireConflict && stats.http.conflicts < 1) {
        throw new Error(
          `Expected --race to provoke at least one 409 stale-baseline retry in ${phase}.`,
        );
      }
      const meta = options.isRotation
        ? inspectRotationMetadata(stats.http)
        : {};
      await input.measured({
        sizeMiB: input.sizeMiB,
        chunkMiB: input.chunkMiB,
        race: input.race,
        sample: input.sample,
        phase,
        ...stats,
        ...meta,
      });
      return value;
    },
  };
}

async function seedAndPrimeRotator<TDevice extends BaselineTierDevice>(
  world: BaselineTierWorld<TDevice>,
  recorder: BaselinePhaseRecorder,
  chunks: readonly string[],
) {
  const [firstChunk, ...restChunks] = chunks;
  if (firstChunk === undefined) {
    throw new Error("Generated chunk list is empty.");
  }
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const teamId = await world.createFolder(alice, world.rootId(alice), "team");
  const handoffId = await world.createFolder(
    alice,
    world.rootId(alice),
    "handoff",
  );

  let history = firstChunk;
  const document = await recorder.record(
    "seed-history",
    () => world.primaryDevice(alice),
    async () => {
      const created = await world.createDocument(alice, teamId, firstChunk);
      for (const chunk of restChunks) {
        history = `${history}${chunk}`;
        await world.editDocument(alice, created, history);
      }
      return created;
    },
  );

  await world.shareWithUser(alice, teamId, bob, "write");
  await world.shareWithUser(alice, handoffId, bob, "write");
  await world.linkDocument(alice, document, handoffId);
  await world
    .primaryDevice(bob)
    .readDocumentUntilText(document.documentId, document.containerIds, history);
  const bobEdited = `${history}bob\n`;
  await world.editDocument(bob, document, bobEdited);
  return { alice, bob, handoffId, document, bobEdited };
}

async function runFreshReaderAndSecondUnlink<
  TDevice extends BaselineTierDevice,
>(input: {
  readonly world: BaselineTierWorld<TDevice>;
  readonly recorder: BaselinePhaseRecorder;
  readonly alice: ProbeActor;
  readonly document: ProbeDocument;
  readonly handoffId: string;
  readonly expectedAfterFirst: string;
}): Promise<void> {
  const { world, recorder, alice, document, handoffId, expectedAfterFirst } =
    input;
  // Log in the fresh empty-DB reader before measuring so `captureSqlWindow()`
  // attributes cold discovery, paged baseline sync, and decrypt SQLite calls.
  const freshReader = await world.newDevice(alice);
  await recorder.record(
    "fresh-reader-sync",
    () => freshReader,
    async () => {
      const store = await freshReader.readDocumentUntilText(
        document.documentId,
        document.containerIds,
        expectedAfterFirst,
      );
      const text = store.getSnapshot().text;
      if (text !== expectedAfterFirst) {
        throw new Error(
          `Fresh reader text mismatch: expected ${expectedAfterFirst.length} chars, got ${text.length}.`,
        );
      }
    },
  );

  // Sync Alice to the post-first-unlink text, re-link into handoff, append one
  // edit, and have Alice unlink handoff so she must pull raw history across
  // Bob's prior baseline group and rebuild.
  await world
    .primaryDevice(alice)
    .readDocumentUntilText(
      document.documentId,
      document.containerIds,
      expectedAfterFirst,
    );
  await world.linkDocument(alice, document, handoffId);
  const round2Text = `${expectedAfterFirst}round 2 edit\n`;
  await world.editDocument(alice, document, round2Text);

  await recorder.record(
    "second-unlink-rotate",
    () => world.primaryDevice(alice),
    () => world.unlinkDocument(alice, document, handoffId),
    { isRotation: true },
  );
}

/**
 * Runs all four rotation-baseline scaling phases (`seed-history`,
 * `first-unlink-rotate`, `fresh-reader-sync`, `second-unlink-rotate`) against
 * the supplied world coordinator.
 */
export async function runBaselineTierWithWorld<
  TDevice extends BaselineTierDevice,
>(
  world: BaselineTierWorld<TDevice>,
  input: {
    readonly sizeMiB: number;
    readonly chunkMiB: number;
    readonly race: boolean;
    readonly sample: number;
    readonly http: () => HttpWireTraffic;
    readonly traffic: () => PostgresTraffic;
    readonly holdBeforeRequest: HoldBeforeRequest;
    readonly measured: (measurement: BaselinePhaseMeasurement) => Promise<void>;
    readonly generateChunks?: (
      totalMiB: number,
      maxChunkMiB: number,
    ) => string[];
  },
): Promise<void> {
  const chunks = (input.generateChunks ?? generateIncompressibleChunks)(
    input.sizeMiB,
    input.chunkMiB,
  );
  const recorder = createBaselineRecorder(input);
  try {
    const { alice, bob, handoffId, document, bobEdited } =
      await seedAndPrimeRotator(world, recorder, chunks);
    const expectedAfterFirst = await recorder.record(
      "first-unlink-rotate",
      () => world.primaryDevice(bob),
      () =>
        runFirstUnlink({
          world,
          alice,
          bob,
          document,
          handoffId,
          baseText: bobEdited,
          race: input.race,
          holdBeforeRequest: input.holdBeforeRequest,
        }),
      { isRotation: true, requireConflict: input.race },
    );
    await runFreshReaderAndSecondUnlink({
      world,
      recorder,
      alice,
      document,
      handoffId,
      expectedAfterFirst,
    });
  } finally {
    world.dispose();
  }
}

/**
 * Runs one `(sizeMiB, race, sample)` rotation-baseline scaling tier using a
 * fresh `MultiUserWorld`.
 */
export async function runBaselineTier(input: {
  readonly apiBaseUrl: string;
  readonly trustOrigin: string;
  readonly sizeMiB: number;
  readonly chunkMiB: number;
  readonly race: boolean;
  readonly sample: number;
  readonly http: () => HttpWireTraffic;
  readonly traffic: () => PostgresTraffic;
  readonly holdBeforeRequest: HoldBeforeRequest;
  readonly measured: (measurement: BaselinePhaseMeasurement) => Promise<void>;
}): Promise<void> {
  const world = new MultiUserWorld(input.apiBaseUrl, input.trustOrigin);
  await runBaselineTierWithWorld(world, input);
}
