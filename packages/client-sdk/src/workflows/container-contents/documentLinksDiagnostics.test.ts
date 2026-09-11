import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixtures";
import { Tearleads } from "../../client/Tearleads";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { relinkRemoteContainerDocument } from "./documentLinks";

type DocumentLinkFailure = { message: string; status: number | null };

interface RelinkDiagnosticsRun {
  readonly failures: DocumentLinkFailure[];
  readonly linked: Awaited<ReturnType<typeof relinkRemoteContainerDocument>>;
  readonly logMessages: string[];
  readonly reported: unknown[];
  readonly thrown: unknown;
}

const LOCAL_LOG_PREFIX =
  "Container contents: failed to link note note to container target: ";

/**
 * Drive the link/unlink/move/purge choke point against a real `Tearleads` host
 * logger. The throwing projection fetch stands in for the work this catch can
 * actually see — SQL, signing, and hard invariants — never a transport or HTTP
 * status, which `ApiClient` returns as a `RequestFailure` instead of throwing.
 */
async function relinkWithThrowingProjection(input: {
  failure: unknown;
  loggerResult: "reject" | "success" | "throw";
}): Promise<RelinkDiagnosticsRun> {
  const failures: DocumentLinkFailure[] = [];
  const logMessages: string[] = [];
  const reported: unknown[] = [];
  const sdk = new Tearleads({
    logger: {
      log: (message) => logMessages.push(message),
      logError: (_message, error) => {
        reported.push(error);
        if (input.loggerResult === "throw")
          throw new Error("Diagnostic transport unavailable");
        if (input.loggerResult === "reject")
          return Promise.reject(new Error("Diagnostic transport unavailable"));
        return undefined;
      },
    },
  });
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-link-diagnostics",
  );
  let linked: Awaited<ReturnType<typeof relinkRemoteContainerDocument>> = null;
  let thrown: unknown = null;
  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const runtime = sdk.containerContents.workflowRuntime();
    linked = await relinkRemoteContainerDocument({
      documentId: "document",
      noteId: "note",
      onFailure: (failure) => failures.push(failure),
      operation: "link",
      resolveProjectionUserKey: async () => null,
      runtime: {
        ...runtime,
        apiClient: createMockApiClient({
          getContainerWriterProjection: async () => null,
          getDocumentWriterProjection: async () => {
            throw input.failure;
          },
        }),
        auth: {
          isAuthenticated: true,
          organizationId: author.organizationId,
          userId: author.signerUserId,
        },
        crypto: {
          encapsulationKeyPair: keyPair,
          signingFingerprint: author.signerKeyFingerprint,
          signingKeyPair: {
            signingPrivateKey: author.signerPrivateKey,
            signingPublicKey,
          },
        },
        infra: { ...runtime.infra, execSql },
        // Stub the incident reporter so the only host-logger traffic left is
        // the link failure itself.
        util: {
          ...runtime.util,
          reportSecurityIncident: async () => undefined,
        },
      } as unknown as Parameters<
        typeof relinkRemoteContainerDocument
      >[0]["runtime"],
      targetContainerId: "target",
    });
  } catch (error) {
    thrown = error;
  } finally {
    close();
    sdk.dispose();
  }
  return { failures, linked, logMessages, reported, thrown };
}

for (const loggerResult of ["success", "throw", "reject"] as const) {
  test(`a document link failure reaches the SDK logger: ${loggerResult}`, async () => {
    const failure = new Error("replaceDocumentLinks failed");

    const run = await relinkWithThrowingProjection({ failure, loggerResult });

    expect(run.reported).toEqual([failure]);
    // A host logger that throws or rejects must not change any of the three
    // parts of this catch's contract.
    expect(run.thrown).toBeNull();
    expect(run.linked).toBeNull();
    expect(run.logMessages).toEqual([`${LOCAL_LOG_PREFIX}${failure.message}`]);
    expect(run.failures).toEqual([{ message: failure.message, status: null }]);
  });
}

test("a database lost mid-mutation is logged locally but not reported", async () => {
  const failure = new DatabaseUnavailableError("DB has been closed.");

  const run = await relinkWithThrowingProjection({
    failure,
    loggerResult: "success",
  });

  expect(run.reported).toEqual([]);
  expect(run.logMessages).toEqual([`${LOCAL_LOG_PREFIX}${failure.message}`]);
  expect(run.failures).toEqual([{ message: failure.message, status: null }]);
});

test("a keying verification failure keeps its rethrow and is not reported", async () => {
  const failure = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );

  const run = await relinkWithThrowingProjection({
    failure,
    loggerResult: "success",
  });

  expect(run.thrown).toBe(failure);
  expect(run.reported).toEqual([]);
  expect(run.logMessages).toEqual([]);
  expect(run.failures).toEqual([]);
});
