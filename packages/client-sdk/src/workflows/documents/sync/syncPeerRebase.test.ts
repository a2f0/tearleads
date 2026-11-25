import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentPeerFrontier,
  type DocumentPeerRebaseErrorCode,
} from "@tearleads/validators/response";
import {
  createPendingUpdateRecord,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { PeerRebaseCommittedCutError } from "../../../data/documents/shared/sync/peerRebase";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { DocumentPeerRebaser } from "./remoteDocumentSyncPass";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-peer-rebase",
  ));
});

afterEach(() => closeExecSql());

const REFUSED: readonly DocumentPeerFrontier[] = [
  { committedEndCounter: 5, peerId: "11" },
];

function peerRefusal(
  code: DocumentPeerRebaseErrorCode,
  peerFrontiers: readonly DocumentPeerFrontier[],
) {
  // Built apart from the return so the field reads as the wire carries it.
  const failure = {
    ...createMockRequestFailure({
      code,
      message: `POST /documents/sync: 409 Conflict: ${code}`,
      status: 409,
    }),
    peerFrontiers,
  };
  return failure;
}

async function syncRefusedPass(input: {
  code?: DocumentPeerRebaseErrorCode;
  peerFrontiers?: readonly DocumentPeerFrontier[];
  /** Submits answered with a retryable stale-state 409 before the refusal. */
  staleSubmits?: number;
  rebase?: DocumentPeerRebaser;
  terminal?: DocumentSyncSubmitFailure[];
}) {
  const { author, resolveProjectionUserKey, signingPublicKey, ...fixture } =
    await createMaterializedSyncFixture();
  const abandoned: string[] = [];
  const submits: number[] = [];
  const terminal = input.terminal ?? [];
  const trace: string[] = [];
  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocumentResult: async (_documentId, request) => {
        submits.push(request.outgoingUpdates.length);
        if (submits.length <= (input.staleSubmits ?? 0)) {
          return createMockRequestFailure({
            code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
            message: "POST /documents/sync: 409 Conflict: State is stale",
            status: 409,
          });
        }
        return peerRefusal(
          input.code ?? DOCUMENT_SYNC_ERROR_CODES.peerOwned,
          input.peerFrontiers ?? REFUSED,
        );
      },
    }),
    author,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onSyncAbandoned: (reason) => abandoned.push(reason),
    onSyncTrace: (line) => trace.push(line),
    onTerminalSubmitFailure: (failure) => {
      terminal.push(failure);
    },
    pendingUpdates: [createPendingUpdateRecord()],
    rebaseOntoFreshPeer: input.rebase,
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: fixture.secretKey,
  });
  return { abandoned, submits, synced, terminal, trace };
}

describe("document sync peer-owned refusal", () => {
  test("hands the refused peers to the rebase and ends the pass", async () => {
    const calls: unknown[] = [];
    const pass = await syncRefusedPass({
      rebase: async (refusal) => {
        calls.push(refusal);
        return "rebased";
      },
    });

    expect(pass.synced).toBeNull();
    expect(calls).toEqual([{ kind: "peer_owned", peerFrontiers: REFUSED }]);
    expect(pass.submits).toEqual([1]);
    expect(pass.terminal).toEqual([]);
    expect(pass.trace.some((line) => line.endsWith("action=rebase-peer"))).toBe(
      true,
    );
  });

  test("hands an uncommitted dependency's peers to the rebase too", async () => {
    const calls: unknown[] = [];
    const pass = await syncRefusedPass({
      code: DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted,
      rebase: async (refusal) => {
        calls.push(refusal);
        return "rebased";
      },
    });

    expect(pass.synced).toBeNull();
    expect(calls).toEqual([
      { kind: "dependency_uncommitted", peerFrontiers: REFUSED },
    ]);
    expect(pass.terminal).toEqual([]);
  });

  test("rebases a refusal on the pass's last attempt", async () => {
    const calls: unknown[] = [];
    const pass = await syncRefusedPass({
      rebase: async (refusal) => {
        calls.push(refusal);
        return "rebased";
      },
      staleSubmits: 2,
    });

    expect(pass.submits).toEqual([1, 1, 1]);
    expect(calls).toEqual([{ kind: "peer_owned", peerFrontiers: REFUSED }]);
    expect(pass.terminal).toEqual([]);
  });

  test("is terminal without a rebase hook", async () => {
    const pass = await syncRefusedPass({});

    expect(pass.synced).toBeNull();
    expect(pass.terminal).toHaveLength(1);
    expect(pass.trace.some((line) => line.endsWith("action=stop"))).toBe(true);
  });

  test("is terminal when the refusal names no peer", async () => {
    let called = false;
    const pass = await syncRefusedPass({
      peerFrontiers: [],
      rebase: async () => {
        called = true;
        return "rebased";
      },
    });

    expect(called).toBe(false);
    expect(pass.terminal).toHaveLength(1);
  });

  test("is terminal when the rebase finds nothing to cut", async () => {
    const pass = await syncRefusedPass({
      rebase: async () => "nothing_to_cut",
    });

    expect(pass.synced).toBeNull();
    expect(pass.terminal).toHaveLength(1);
  });

  test("ends the pass after a relay without a failure", async () => {
    const pass = await syncRefusedPass({
      code: DOCUMENT_SYNC_ERROR_CODES.dependencyUncommitted,
      rebase: async () => "relayed",
    });

    expect(pass.synced).toBeNull();
    expect(pass.submits).toEqual([1]);
    expect(pass.terminal).toEqual([]);
    expect(pass.abandoned).toEqual([]);
  });

  test("reports a park as waiting on the owner, not as the refusal", async () => {
    const pass = await syncRefusedPass({ rebase: async () => "parked" });

    expect(pass.synced).toBeNull();
    expect(pass.submits).toEqual([1]);
    expect(
      pass.terminal.map(({ code, message, status }) => ({
        code,
        message,
        status,
      })),
    ).toEqual([
      {
        code: "document_peer_restore_awaits_owner",
        message:
          "The server lost committed history that only the document owner's devices may restore; queued changes sync afterwards",
        status: null,
      },
    ]);
    expect(pass.abandoned).toEqual(["peer-restore-awaits-owner"]);
  });

  // A forged committed operation: the guard is a failure, never a recovery.
  test("records a failed rebase as terminal and rethrows it", async () => {
    const failure = new PeerRebaseCommittedCutError("21", 0, 5);
    const terminal: DocumentSyncSubmitFailure[] = [];
    let thrown: unknown;
    try {
      await syncRefusedPass({
        rebase: async () => {
          throw failure;
        },
        terminal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failure);
    expect(terminal).toHaveLength(1);
  });
});
