import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerMutationResponseFromRequest,
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../../test/helpers/trustedUserIdentity";
import { createContainerMetadataDocument } from "../../../../data/containers/containerMetadataDocument";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../containerPersistence";
import type { ContainerState } from "../../remoteHydration";
import { createTestContainerState } from "../containerState.testFixtures";
import type {
  ContainerMoveIntentSyncHost,
  ContainerMoveIntentSyncState,
} from "../types";
import { syncPendingContainerMoveIntents } from "./moveIntentSync";

/**
 * Replays one queued move of `moved` from root into `destination` against a
 * server that accepts it, then lets the scenario lose the result.
 */
async function replayAcceptedMove(input: {
  /** The server already holds the folder under the destination. */
  alreadyApplied?: boolean;
  /** Checkpoint writes fail once the server has accepted the move. */
  failCheckpointWrites?: boolean;
  /** The folder's writer projection cannot be read. */
  projectionUnavailable?: boolean;
  host: ContainerMoveIntentSyncHost;
  /** Flips once the server has accepted the move. */
  staleAfterAcceptance: boolean;
}) {
  const { author, signingPublicKey } = await createAuthor();
  const kem = generateKemSeedAndKeyPair();
  const signer = {
    encapsulationPublicKey: kem.publicKey,
    organizationId: author.organizationId,
    signerDeviceId: author.signerDeviceId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const root = await createContainerWriterProjectionFixture({
    ...signer,
    containerId: "root",
  });
  const destination = await createContainerWriterProjectionFixture({
    ...signer,
    containerId: "destination",
    parentProjection: root,
  });
  const moved = await createContainerWriterProjectionFixture({
    ...signer,
    containerId: "moved",
    parentProjection: input.alreadyApplied ? destination : root,
  });
  if (!moved || !destination) throw new Error("Expected signed fixtures");
  const database = await createTestExecSql("container-move-accepted-reports");
  const containerState = (id: string, parentId: string | null) =>
    createTestContainerState({
      id,
      organizationId: author.organizationId,
      parentId,
    });
  const movedLocally = containerState("moved", "destination");
  movedLocally.doc = await createContainerMetadataDocument("moved");
  movedLocally.container = {
    ...movedLocally.container,
    serverCreatedAt: "2026-10-19T00:00:00.000Z",
    serverUpdatedAt: "2026-10-19T00:01:00.000Z",
  };
  await defaultContainerContentsPersistence.ensureSchema(database.execSql);
  await defaultContainerContentsPersistence.saveContainer(
    database.execSql,
    movedLocally.container,
    movedLocally.record,
    {
      moveIntent: {
        parentContainerId: "destination",
        previousParentContainerId: "root",
      },
    },
  );
  let accepted = false;
  let current = true;
  let retries = 0;
  const resumed: string[] = [];
  let submissions = 0;
  const execSql = ((sql: string, ...rest: [never, never]) =>
    input.failCheckpointWrites &&
    accepted &&
    /^\s*(insert|update)\b[^;]*access_manifest_checkpoints/iu.test(sql)
      ? Promise.reject(new Error("disk I/O error"))
      : database.execSql(sql, ...rest)) as ExecSql;
  const reconciled: (string | null)[] = [];
  const reports: { error: unknown; message: string }[] = [];
  const state: ContainerMoveIntentSyncState = {
    containersById: new Map<string, ContainerState>([
      ["root", containerState("root", null)],
      ["destination", containerState("destination", "root")],
      ["moved", movedLocally],
    ]),
    persistence: defaultContainerContentsPersistence,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: kem.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    runtime: {
      apiClient: createMockApiClient({
        getContainerWriterProjection: async (id) =>
          input.projectionUnavailable
            ? null
            : id === "moved"
              ? moved
              : destination,
        moveContainerResult: async (_id, request) => {
          submissions += 1;
          const data = await createContainerMutationResponseFromRequest(
            request,
            moved,
            [...root.path, ...destination.path],
          );
          accepted = true;
          if (input.staleAfterAcceptance) current = false;
          return { data, ok: true as const };
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: kem,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      infra: {
        blobStore:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "root",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        log: () => {},
        logError: (message, error) => {
          reports.push({ error, message: String(message) });
        },
        reportSecurityIncident: async () => {},
      },
    },
  };
  try {
    const movedCount = await syncPendingContainerMoveIntents({
      host: input.host,
      isCreatePending: () => false,
      isCurrent: () => current,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: (parentId) => {
        reconciled.push(parentId);
      },
      acceptedMoveRetry: {
        arm: () => {
          retries += 1;
        },
        resume: (intentId) => {
          resumed.push(intentId);
        },
      },
      state,
    });
    const queued =
      await defaultContainerContentsPersistence.listUnsyncedMoveIntents(
        database.execSql,
      );
    return {
      movedCount,
      queued,
      reconciled,
      reports,
      resumed,
      retries,
      submissions,
    };
  } finally {
    database.close();
  }
}

const unusedHost: ContainerMoveIntentSyncHost = {
  persistContainerState: async () => {
    throw new Error("a stale pass must not persist");
  },
  updateSnapshot: () => {},
};

test("a stale pass that drops an accepted move reports it once", async () => {
  const outcome = await replayAcceptedMove({
    host: unusedHost,
    staleAfterAcceptance: true,
  });
  expect(outcome.submissions).toBe(1);
  expect(outcome.movedCount).toBe(0);
  // The next pass re-posts the move the server already holds.
  expect(outcome.queued).toHaveLength(1);
  expect(outcome.reconciled).toEqual(["destination"]);
  expect(outcome.reports.map(({ message }) => message)).toEqual([
    "Container contents: a stale sync pass dropped an accepted container move",
  ]);
  expect(outcome.reports[0]?.error).toBeInstanceOf(Error);
  // The replay that pass schedules finds the move applied.
  expect(outcome.retries).toBe(1);
}, 30_000);

test("an accepted move that fails to persist reports it once", async () => {
  const outcome = await replayAcceptedMove({
    host: {
      persistContainerState: async () => ({ status: "missing" }),
      updateSnapshot: () => {},
    },
    staleAfterAcceptance: false,
  });
  expect(outcome.submissions).toBe(1);
  expect(outcome.movedCount).toBe(0);
  expect(outcome.queued).toHaveLength(1);
  expect(outcome.reports.map(({ message }) => message)).toEqual([
    "Container contents: an accepted container move did not persist",
  ]);
  expect(outcome.retries).toBe(1);
}, 30_000);

test("a replay of a move the server already holds settles without posting", async () => {
  const persisted: Parameters<
    ContainerMoveIntentSyncHost["persistContainerState"]
  >[] = [];
  const outcome = await replayAcceptedMove({
    alreadyApplied: true,
    host: {
      persistContainerState: async (...args) => {
        persisted.push(args);
        return {
          moveIntentSettled: true,
          record: args[0].record,
          status: "persisted",
        };
      },
      updateSnapshot: () => {},
    },
    staleAfterAcceptance: false,
  });
  expect(outcome.submissions).toBe(0);
  expect(outcome.movedCount).toBe(1);
  expect(outcome.reports).toEqual([]);
  expect(outcome.retries).toBe(0);
  const [candidate, patch, , saveOptions, mutationOptions] = persisted[0] ?? [];
  expect(persisted).toHaveLength(1);
  expect(patch).toMatchObject({ parentId: "destination" });
  // The verified head's epoch and hash, with the timestamps already held.
  expect(patch?.accessEpoch).toBeGreaterThan(0);
  expect(typeof patch?.accessStateHash).toBe("string");
  expect(saveOptions?.serverTimestamps).toEqual({
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:01:00.000Z",
  });
  expect(candidate?.container.id).toBe("moved");
  expect(mutationOptions?.moveIntentSettlement?.containerId).toBe("moved");
}, 30_000);

test("an acknowledgement that throws after acceptance re-arms the replay", async () => {
  const outcome = await replayAcceptedMove({
    failCheckpointWrites: true,
    host: unusedHost,
    staleAfterAcceptance: false,
  });
  expect(outcome.submissions).toBe(1);
  expect(outcome.movedCount).toBe(0);
  expect(outcome.queued).toHaveLength(1);
  expect(outcome.reports.map(({ message }) => message)).toEqual([
    "Container contents: an accepted container move failed to settle",
  ]);
  expect(outcome.retries).toBe(1);
}, 30_000);

test("a replay that cannot read its projection resumes an accepted move's retries", async () => {
  const outcome = await replayAcceptedMove({
    host: unusedHost,
    projectionUnavailable: true,
    staleAfterAcceptance: false,
  });
  expect(outcome.submissions).toBe(0);
  expect(outcome.queued).toHaveLength(1);
  // Only an earlier acceptance gives the retry policy a budget to resume.
  expect(outcome.retries).toBe(0);
  expect(outcome.resumed).toEqual(outcome.queued.map(({ id }) => id));
}, 30_000);
