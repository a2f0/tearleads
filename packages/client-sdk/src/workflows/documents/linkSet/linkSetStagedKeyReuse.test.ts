// An unlink commits a fresh content key so that the container it removes
// cannot read what is written afterwards. A staged upload holds a key
// between attempts; these tests hold the unlink to taking that key only
// when no request ever carried it to a container the unlink leaves out.
import { expect, setDefaultTimeout, test } from "bun:test";
import { exportFullHistorySnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import {
  createLongHistoryDocument,
  STAGED_BASELINE_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { createStagedUnlinkHarness } from "../../../../test/helpers/workflows/stagedBaselineUnlink";
import { deriveDocumentContentKeyCommitment } from "../../../data/documents/shared/sync/contentKeyCommitment";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { writeRotationBaseline } from "../baselineStage/rotationBaselineWriter";
import { getOrCreateStagedBaselineUploads } from "../baselineStage/stagedBaselineUploads";

setDefaultTimeout(STAGED_BASELINE_TEST_TIMEOUT_MS);

type Harness = Awaited<ReturnType<typeof createStagedUnlinkHarness>>;

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

const stale = {
  code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
  message: "the baseline does not cover the committed frontier",
  status: 409,
};

/** The containers a request wraps its content key for. */
const wrappedFor = (request: Harness["requests"][number] | undefined) =>
  request?.contentKeyBundle.targets.map((target) => target.containerId);

// A heal wraps its key for every linked container and sends it. Refused
// for coverage or never answered, its upload stays, and the key with it.
// An unlink of one of those containers must not commit that key: the
// container's members, and whoever kept the heal's request, hold it.
test("an unlink does not take the key a heal's upload sent to the container it removes", () =>
  withDatabase("heal-then-unlink", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const { documentId, fixture, server } = harness;
    const document = await createLongHistoryDocument("heal-then-unlink");
    const bundle = fixture.writerProjection.contentKeyBundle;
    const healKey = crypto.getRandomValues(new Uint8Array(32));
    const contentKeyEpoch = bundle.contentKeyEpoch + 1;
    // The heal's upload: every segment but the final one staged, and its
    // sync, which carried the key to both containers, not answered.
    const healed = await writeRotationBaseline({
      api: server.api,
      contentKey: healKey,
      contentKeyEpoch,
      documentId,
      execSql,
      inlineCharacters: 0,
      keyTargets: bundle.targets,
      organizationId: fixture.author.organizationId,
      plan: { linkSetEvent: undefined, signedAt: "2026-07-26T00:00:00.000Z" },
      purpose: "Heal",
      segmentSizes: SMALL_BASELINE_SEGMENTS,
      signer: {
        identity: "heal",
        sign: async (update) => ({
          ...update,
          writeHeader: {
            ciphertextHash: update.ciphertextHash,
            contentKeyEpoch,
            metadataHash: update.metadataHash,
          },
        }),
      },
      snapshot: exportFullHistorySnapshot(document),
    });
    expect(healed.kind).toBe("staged");
    expect(bundle.targets).toHaveLength(2);
    const healStage = server.stage(documentId)?.baselineId;
    const callsBefore = server.calls.length;

    const unlinked = await harness.unlink(document, execSql);

    expect(unlinked?.contentKeyRotated).toBe(true);
    const [request] = harness.requests;
    expect(request?.contentKeyBundle.contentKeyEpoch).toBe(contentKeyEpoch);
    expect(request?.contentKeyBundle.contentKeyCommitment).not.toBe(
      await deriveDocumentContentKeyCommitment({
        contentKey: healKey,
        contentKeyEpoch,
        documentId,
      }),
    );
    // The heal's stage held segments under the key that went to the
    // removed container: it is deleted, and the baseline uploaded anew.
    expect(server.calls.slice(callsBefore, callsBefore + 3)).toEqual([
      "abandon",
      "open",
      "stage:0",
    ]);
    expect(request?.baselineStageId).not.toBe(healStage);
    expect(server.committed).toHaveLength(1);
  }));

// The same between two unlinks: the first carried its key to the container
// the second removes.
test(
  "an unlink does not take the key a refused unlink of another container sent",
  () =>
    withDatabase("unlink-x-then-y", async (execSql) => {
      const harness = await createStagedUnlinkHarness();
      const { fixture, server } = harness;
      const document = await createLongHistoryDocument("unlink-x-then-y");
      harness.script.refuse = (_request, ordinal) =>
        ordinal === 1 ? stale : null;
      expect(await harness.unlink(document, execSql)).toBeNull();
      const [first] = harness.requests;
      expect(wrappedFor(first)).toEqual([fixture.parent.containerId]);
      const callsBefore = server.calls.length;

      const unlinked = await harness.unlink(document, execSql, {
        container: "parent",
      });

      expect(unlinked?.contentKeyRotated).toBe(true);
      const [, second] = harness.requests;
      expect(wrappedFor(second)).toEqual([fixture.child.containerId]);
      expect(second?.contentKeyBundle.contentKeyCommitment).not.toBe(
        first?.contentKeyBundle.contentKeyCommitment,
      );
      expect(second?.baselineStageId).not.toBe(first?.baselineStageId);
      // Neither the key nor the event of the first unlink is the second's.
      expect(second?.event).not.toEqual(first?.event);
      expect(server.calls.slice(callsBefore, callsBefore + 3)).toEqual([
        "abandon",
        "open",
        "stage:0",
      ]);
    }),
  60_000,
);

// The retry of the same unlink wraps the key for the same containers, so it
// goes on with the upload: the same key, the same stage, nothing sent again.
test("the retry of the same unlink keeps its key and its stage", () =>
  withDatabase("unlink-x-again", async (execSql) => {
    const harness = await createStagedUnlinkHarness();
    const { documentId, server } = harness;
    const document = await createLongHistoryDocument("unlink-x-again");
    harness.script.refuse = (_request, ordinal) =>
      ordinal === 1 ? stale : null;
    expect(await harness.unlink(document, execSql)).toBeNull();
    const staged = server.stage(documentId)?.segments.length ?? 0;
    const callsBefore = server.calls.length;

    const unlinked = await harness.unlink(document, execSql);

    expect(unlinked?.contentKeyRotated).toBe(true);
    const [first, second] = harness.requests;
    expect(second?.contentKeyBundle.contentKeyCommitment).toBe(
      first?.contentKeyBundle.contentKeyCommitment,
    );
    expect(second?.baselineStageId).toBe(first?.baselineStageId);
    expect(server.calls.slice(callsBefore)).toEqual(["get"]);
    expect(server.committed.at(-1)).toHaveLength(staged + 1);
    expect(
      getOrCreateStagedBaselineUploads(execSql).get(documentId),
    ).toBeNull();
  }));
