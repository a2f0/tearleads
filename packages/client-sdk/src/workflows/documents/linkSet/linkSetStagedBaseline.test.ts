// An unlink whose rotation baseline does not fit its request uploads every
// segment but the final one to a stage and commits by the final segment.
import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  historySegmentsImportInOrder,
  mergeVersionVectors,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_BASELINE_SEGMENTS,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "@tearleads/validators/util";
import {
  appendHistory,
  createLongHistoryDocument,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { createStagedUnlinkHarness } from "../../../../test/helpers/workflows/stagedBaselineUnlink";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

type Harness = Awaited<ReturnType<typeof createStagedUnlinkHarness>>;
type HistoryDocument = Awaited<ReturnType<typeof createDocument>>;

async function withDatabase(
  name: string,
  run: (execSql: ExecSql) => Promise<void>,
) {
  const { close, execSql } = await createTestExecSql(name);
  try {
    await run(execSql);
  } finally {
    close();
  }
}

/** The last group the server committed, whole and at `document`'s version. */
function committedGroup(harness: Harness, document: HistoryDocument) {
  const group = harness.server.committed.at(-1) ?? [];
  expect(historySegmentsImportInOrder(group)).toBe(true);
  expect(
    versionVectorsEqual(
      mergeVersionVectors(
        group.map((segment) => segment.partialEndVersionVector),
      ),
      encodeVersionVector(document),
    ),
  ).toBe(true);
  return group;
}

const stale = {
  code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
  message: "the baseline does not cover the committed frontier",
  status: 409,
};

const calls = (harness: Harness, prefix: string) =>
  harness.server.calls.filter((call) => call.startsWith(prefix));

test("an unlink over more segments than a request carries commits through a stage", () =>
  withDatabase("staged-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("staged-unlink");

    const unlinked = await harness.unlink(document, execSql);

    expect(unlinked?.contentKeyRotated).toBe(true);
    expect(unlinked?.linkedContainerIds).toEqual([
      harness.fixture.parent.containerId,
    ]);
    const group = committedGroup(harness, document);
    expect(group.length).toBeGreaterThan(MAX_DOCUMENT_BASELINE_SEGMENTS);
    expect(harness.server.calls).toEqual([
      "open",
      ...group.slice(0, -1).map((_, index) => `stage:${index}`),
    ]);
    // The unlink carries the final segment alone and names the stage.
    expect(harness.requests).toHaveLength(1);
    const [request] = harness.requests;
    expect(request?.rotationBaseline).toHaveLength(1);
    expect(request?.baselineStageId).toBe(
      request?.rotationBaseline?.[0]?.baselineId,
    );
    expect(harness.failures).toEqual([]);
  }));

test("an unlink whose history fits one request sends one request and opens no stage", () =>
  withDatabase("inline-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("inline-unlink", 20);

    expect(await harness.unlink(document, execSql)).not.toBeNull();

    expect(harness.server.calls).toEqual([]);
    expect(harness.requests).toHaveLength(1);
    const [request] = harness.requests;
    expect(request?.baselineStageId).toBeUndefined();
    const segments = request?.rotationBaseline ?? [];
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.at(-1)?.baselineSegmentCount).toBe(segments.length);
  }));

// The defect of #3238 on the unlink path: the API refused the body.
test(
  "an unlink over 16 MiB of history commits through a stage at the default sizes",
  () =>
    withDatabase("large-staged-unlink", async (execSql) => {
      const harness = await createStagedUnlinkHarness();
      const document = await createDocument("large-staged-unlink");
      const bytes = new Uint8Array(13 * 1024 * 1024);
      for (let offset = 0; offset < bytes.length; offset += 65_536) {
        crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
      }
      document.getText("text").insert(0, bytes.toBase64());
      document.commit();

      const unlinked = await harness.unlink(document, execSql, {
        segmentSizes: undefined,
      });

      expect(unlinked?.contentKeyRotated).toBe(true);
      const group = committedGroup(harness, document);
      expect(group.length).toBeGreaterThan(2);
      expect(harness.server.stagedCharacters).toBeGreaterThan(
        MAX_DOCUMENT_SYNC_REQUEST_BYTES,
      );
      expect(harness.requests).toHaveLength(1);
      const [final] = harness.requests[0]?.rotationBaseline ?? [];
      expect(final?.encryptedData.length).toBeLessThan(2 * 1024 * 1024);
    }),
  120_000,
);

test("an unlink refused as stale keeps its stage, and the retry appends a tail under the same plan", () =>
  withDatabase("stale-unlink-tail", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("stale-unlink-tail");
    harness.script.refuse = (_request, ordinal) =>
      ordinal === 1 ? stale : null;

    // The refusal reaches the caller, which proves the history again.
    expect(await harness.unlink(document, execSql)).toBeNull();
    expect(harness.failures.map((failure) => failure.code)).toEqual([
      stale.code,
    ]);
    const stagedBefore =
      harness.server.stage(harness.documentId)?.segments.length ?? 0;
    expect(stagedBefore).toBeGreaterThan(64);
    const callsBefore = harness.server.calls.length;

    // A writer raced the rotator: the re-proven history holds its edits.
    appendHistory(document, 5);
    const unlinked = await harness.unlink(document, execSql);

    expect(unlinked?.contentKeyRotated).toBe(true);
    const group = committedGroup(harness, document);
    expect(group.length).toBeGreaterThan(stagedBefore + 1);
    const resumed = harness.server.calls.slice(callsBefore);
    expect(resumed.slice(0, 2)).toEqual(["get", `stage:${stagedBefore}`]);
    expect(resumed).not.toContain("open");
    // The retry planned as the upload did: the same event, signed time and
    // key give the same manifest, so no staged header is signed again.
    const [first, second] = harness.requests;
    expect(second?.expectedManifestHash).toBe(first?.expectedManifestHash);
    expect(second?.contentKeyBundle.contentKeyCommitment).toBe(
      first?.contentKeyBundle.contentKeyCommitment,
    );
    expect(second?.baselineStageId).toBe(first?.baselineStageId);
    expect(calls(harness, "resign:")).toEqual([]);
  }));

test("an unlink whose staged headers went stale signs them again and resubmits", () =>
  withDatabase("stale-headers-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("stale-headers-unlink");
    harness.script.refuse = (_request, ordinal) =>
      ordinal === 1
        ? {
            baselineStageCode: STAGE.headersStale,
            code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
            message: "staged headers do not name the final segment's manifest",
            status: 409,
          }
        : null;

    const unlinked = await harness.unlink(document, execSql);

    expect(unlinked?.contentKeyRotated).toBe(true);
    const group = committedGroup(harness, document);
    expect(calls(harness, "stage:")).toHaveLength(group.length - 1);
    expect(calls(harness, "resign:")).toEqual(
      group.slice(0, -1).map((_, index) => `resign:${index}`),
    );
    expect(harness.requests).toHaveLength(2);
    // The leg recovered: its caller hears of no refusal.
    expect(harness.failures).toEqual([]);
  }));

test("a retry that plans another manifest signs the staged headers before it commits", () =>
  withDatabase("replanned-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("replanned-unlink");
    harness.script.refuse = (_request, ordinal) =>
      ordinal === 1 ? stale : null;
    expect(await harness.unlink(document, execSql)).toBeNull();
    const stagedBefore =
      harness.server.stage(harness.documentId)?.segments.length ?? 0;
    const callsBefore = harness.server.calls.length;

    // Another event id is another event, so another manifest hash.
    const unlinked = await harness.unlink(document, execSql, {
      eventId: crypto.randomUUID(),
    });

    expect(unlinked?.contentKeyRotated).toBe(true);
    committedGroup(harness, document);
    const [first, second] = harness.requests;
    expect(second?.expectedManifestHash).not.toBe(first?.expectedManifestHash);
    // The writer knew its headers were stale and never asked the API.
    expect(harness.requests).toHaveLength(2);
    expect(harness.server.calls.slice(callsBefore)).toEqual([
      "get",
      ...Array.from({ length: stagedBefore }, (_, index) => `resign:${index}`),
    ]);
  }));

test("an unlink that is no longer wanted stops uploading and reports nothing", () =>
  withDatabase("ended-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("ended-unlink");
    let current = true;
    harness.server.beforeNext("stage:3", () => {
      current = false;
    });

    expect(
      await harness.unlink(document, execSql, { stillCurrent: () => current }),
    ).toBeNull();

    expect(harness.requests).toEqual([]);
    expect(harness.failures).toEqual([]);
    expect(harness.server.calls.at(-1)).toBe("stage:3");
  }));

// A stage request refused for the caller keeps its status on the way to
// the leg's caller, as a refused unlink does: nothing is retried, and the
// stage the writer gave up is deleted.
test("a stage request refused for access is the unlink's refusal", () =>
  withDatabase("refused-stage-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const document = await createLongHistoryDocument("refused-stage-unlink");
    harness.server.refuseNext("stage:2", {
      message: "PUT segment: 403 Forbidden",
      status: 403,
    });

    expect(await harness.unlink(document, execSql)).toBeNull();

    expect(harness.failures).toEqual([
      { code: undefined, message: "PUT segment: 403 Forbidden", status: 403 },
    ]);
    expect(harness.requests).toEqual([]);
    expect(harness.server.calls.slice(-2)).toEqual(["stage:2", "abandon"]);
    expect(harness.server.stage(harness.documentId)).toBeNull();
  }));
