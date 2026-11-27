// What the stage routes hold a writer to beyond the order of its segments:
// the bounds every write header meets, and the refusals of a header signed
// again.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createIdentitySeedPhrase,
  generateIdentityKeyPairsFromSeedPhrase,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
} from "@tearleads/validators/util";
import {
  createLongHistoryDocument,
  createStagedHealHarness,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { resolveDocumentCreateAuthor } from "../author";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-staged-contract",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

const headersStale = {
  baselineStageCode: STAGE.headersStale,
  code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
  message: "commit refused: staged headers are stale",
  status: 409,
};

function text(header: Record<string, unknown>, name: string): string {
  const value = header[name];
  if (typeof value !== "string") throw new Error(`Expected header ${name}`);
  return value;
}

// The API refuses a header whose device id is over 128 characters (400),
// whose signature is not canonical base64 (403), or that cites more than
// 6,400 manifests (400), and a header signed again in a request over
// 512 KiB (413). Every header the writer sends is signed by one function,
// which is held here to all four: staged, signed again, and final.
test("every header a staged baseline sends meets the bounds the API holds it to", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("header-bounds");
  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1 ? headersStale : null;

  const synced = await harness.heal(document, execSql);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const staged = harness.server.calls.filter((call) =>
    call.startsWith("stage:"),
  );
  const resigned = harness.server.calls.filter((call) =>
    call.startsWith("resign:"),
  );
  expect(resigned).toHaveLength(staged.length);
  const finals = harness.requests.map(
    (request) => request.outgoingUpdates[0]?.writeHeader ?? {},
  );
  const headers = [...harness.server.headers, ...finals];
  expect(headers).toHaveLength(staged.length + resigned.length + 2);
  for (const header of headers) {
    const deviceId = text(header, "writerDeviceId");
    expect(deviceId).toBe(harness.fixture.author.signerDeviceId);
    expect(deviceId.length).toBeLessThanOrEqual(
      MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
    );
    const signature = text(header, "signature");
    expect(bytesToBase64(base64ToBytes(signature))).toBe(signature);
    const citations: unknown = Reflect.get(header, "dependencyManifestHashes");
    expect(Array.isArray(citations) && citations.length).toBeLessThanOrEqual(
      MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
    );
    expect(
      new TextEncoder().encode(JSON.stringify({ writeHeader: header })).length,
    ).toBeLessThanOrEqual(MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES);
  }
});

// A header signed again moves the stage's byte count by the difference
// between the two headers, so signing again can be what fills the stage.
test("a header signed again that fills the stage deletes it and names the limit", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("resign-too-large");
  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1 ? headersStale : null;
  harness.server.refuseNext("resign:2", { code: STAGE.tooLarge, status: 409 });

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(harness.server.calls.slice(-2)).toEqual(["resign:2", "abandon"]);
  expect(harness.server.stage(harness.documentId)).toBeNull();
  expect(harness.requests).toHaveLength(1);
  expect(harness.terminalFailures).toMatchObject([
    { code: "document_sync_request_too_large", status: null },
  ]);
});

// The route takes a header of at most 512 KiB. A refusal for its size is
// one a retry would meet again: the upload is given up and its stage is
// deleted, as for any request the API will not take.
test("a header signed again that the route refuses for its size gives the upload up", async () => {
  const harness = await createStagedHealHarness();
  const document = await createLongHistoryDocument("resign-oversized");
  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1 ? headersStale : null;
  harness.server.refuseNext("resign:1", {
    message: "PUT write-header: 413 Content Too Large",
    status: 413,
  });

  expect(await harness.heal(document, execSql)).toBeNull();

  expect(harness.server.calls.slice(-2)).toEqual(["resign:1", "abandon"]);
  expect(harness.server.stage(harness.documentId)).toBeNull();
  expect(harness.requests).toHaveLength(1);
  expect(harness.terminalFailures.map((failure) => failure.status)).toEqual([
    413,
  ]);
});

// The SDK names a device after its signing key, so the name's length is the
// fingerprint's plus a fixed prefix, whatever the host.
test("the device id an author signs with fits a write header", async () => {
  const { signingKeyPair } = generateIdentityKeyPairsFromSeedPhrase(
    createIdentitySeedPhrase(),
  );
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  expect(signingFingerprint).toMatch(/^[0-9a-f]{64}$/u);

  const author = resolveDocumentCreateAuthor({
    auth: { organizationId: "organization-1", userId: "user-1" },
    crypto: { signingFingerprint, signingKeyPair },
  });

  expect(author?.signerDeviceId).toBe(`signing-key:${signingFingerprint}`);
  expect(author?.signerDeviceId.length).toBe(76);
  expect(author?.signerDeviceId.length).toBeLessThanOrEqual(
    MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
  );
});
