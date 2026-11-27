// The five rotation-baseline stage routes, and what a refusal tells the
// writer: the stage's own code, and the index a stage expects next.
import { expect, test } from "bun:test";
import {
  documentSyncOperation,
  stageDocumentBaselineSegmentOperation,
  unlinkDocumentOperation,
} from "@tearleads/validators/operation";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import type { DocumentBaselineStageStatusResponse } from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  type CapturedHttpCall,
  captureHttpCall,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { describeErrorResponse } from "./requestInternals";

const DOCUMENT_ID = "0b6d7e0e-3c5a-4d0f-9a51-7b1f5c2a9e10";
const BASELINE_ID = "5f0c1d8e-6f0b-4c6e-8a55-0c2f3e1d4b6a";
const STAGE = `${apiBaseUrl}/documents/${DOCUMENT_ID}/baseline-stages`;

const status: DocumentBaselineStageStatusResponse = {
  baselineId: BASELINE_ID,
  contentKeyCommitment: "a".repeat(64),
  contentKeyEpoch: 2,
  expiresAt: "2026-07-26T01:00:00.000Z",
  nextSegmentIndex: 1,
  segmentsDigest: "b".repeat(64),
  stagedBytes: 12,
};

const segment: DocumentOutgoingUpdate = {
  baselineId: BASELINE_ID,
  baselineSegmentIndex: 0,
  dependencyVersionVector: "AA==",
  encryptedData: "ciphertext",
  id: "9d2c3b4a-1e0f-4a8b-9c7d-6e5f4a3b2c1d",
  partialEndVersionVector: "AA==",
  partialStartVersionVector: "AA==",
  plaintextHash: "c".repeat(64),
  writeHeader: { signedAt: "2026-07-26T00:00:00.000Z" },
};

testApiClient("each stage call reaches its route", async () => {
  const calls: CapturedHttpCall[] = [];
  server.use(
    http.all(`${apiBaseUrl}/*`, async ({ request }) => {
      calls.push(await captureHttpCall(request));
      return HttpResponse.json(
        request.method === "DELETE" ? { baselineId: BASELINE_ID } : status,
      );
    }),
  );
  const client = new ApiClient(apiBaseUrl);
  const open = {
    baselineId: BASELINE_ID,
    contentKeyCommitment: status.contentKeyCommitment,
    contentKeyEpoch: 2,
  };
  const header = { writeHeader: { signedAt: "2026-07-26T00:05:00.000Z" } };

  expect(
    await client.openDocumentBaselineStageResult(DOCUMENT_ID, open),
  ).toEqual({ data: status, ok: true });
  expect(
    await client.stageDocumentBaselineSegmentResult(
      DOCUMENT_ID,
      BASELINE_ID,
      0,
      segment,
    ),
  ).toEqual({ data: status, ok: true });
  expect(
    await client.resignDocumentBaselineSegmentHeaderResult(
      DOCUMENT_ID,
      BASELINE_ID,
      0,
      header,
    ),
  ).toEqual({ data: status, ok: true });
  expect(
    await client.getDocumentBaselineStageResult(DOCUMENT_ID, BASELINE_ID),
  ).toEqual({ data: status, ok: true });
  expect(
    await client.abandonDocumentBaselineStageResult(DOCUMENT_ID, BASELINE_ID),
  ).toEqual({ data: { baselineId: BASELINE_ID }, ok: true });

  expect(
    calls.map((call) => [call.method, call.url, call.body || null]),
  ).toEqual([
    ["POST", STAGE, JSON.stringify(open)],
    ["PUT", `${STAGE}/${BASELINE_ID}/segments/0`, JSON.stringify(segment)],
    [
      "PUT",
      `${STAGE}/${BASELINE_ID}/segments/0/write-header`,
      JSON.stringify(header),
    ],
    ["GET", `${STAGE}/${BASELINE_ID}`, null],
    ["DELETE", `${STAGE}/${BASELINE_ID}`, null],
  ]);
});

testApiClient("a stage refusal keeps its code and next index", async () => {
  server.use(
    http.put(`${STAGE}/${BASELINE_ID}/segments/3`, () =>
      HttpResponse.json(
        {
          code: "document_baseline_stage_segment_out_of_order",
          error: "Document baseline segment is not the stage's next",
          nextSegmentIndex: 2,
        },
        { status: 409 },
      ),
    ),
    http.get(`${STAGE}/${BASELINE_ID}`, () =>
      HttpResponse.json(
        {
          code: "document_baseline_stage_not_found",
          error: "Document baseline stage not found",
        },
        { status: 404 },
      ),
    ),
  );
  const client = new ApiClient(apiBaseUrl);

  expect(
    await client.stageDocumentBaselineSegmentResult(
      DOCUMENT_ID,
      BASELINE_ID,
      3,
      { ...segment, baselineSegmentIndex: 3 },
      { reportErrors: false },
    ),
  ).toMatchObject({
    code: "document_baseline_stage_segment_out_of_order",
    nextSegmentIndex: 2,
    ok: false,
    status: 409,
  });
  expect(
    await client.getDocumentBaselineStageResult(DOCUMENT_ID, BASELINE_ID, {
      reportErrors: false,
    }),
  ).toMatchObject({
    code: "document_baseline_stage_not_found",
    ok: false,
    status: 404,
  });
});

// A writer that is refused for the open-stage limit can only clear a stage a
// restarted process left if the refusal's list reaches it.
testApiClient(
  "an open refused for the limit names the open stages",
  async () => {
    const openStages = [1, 2, 3, 4].map((index) => ({
      baselineId: `5f0c1d8e-6f0b-4c6e-8a55-0c2f3e1d4b6${index}`,
      documentId: `document-${index}`,
      expiresAt: `2026-07-26T0${index}:00:00.000Z`,
    }));
    const refuse = (body: Record<string, unknown>) =>
      server.use(
        http.post(STAGE, () =>
          HttpResponse.json(
            {
              code: "document_baseline_stage_limit_reached",
              error: "Too many open document baseline stages",
              ...body,
            },
            { status: 409 },
          ),
        ),
      );
    const client = new ApiClient(apiBaseUrl);
    const open = () =>
      client.openDocumentBaselineStageResult(
        DOCUMENT_ID,
        {
          baselineId: BASELINE_ID,
          contentKeyCommitment: "a".repeat(64),
          contentKeyEpoch: 2,
        },
        { reportErrors: false },
      );

    refuse({ openStages });
    expect(await open()).toMatchObject({
      code: "document_baseline_stage_limit_reached",
      ok: false,
      openStages,
      status: 409,
    });

    // A list the schema does not admit is not handed on in part.
    refuse({ openStages: [...openStages, ...openStages] });
    const unlisted = await open();
    expect(unlisted).toMatchObject({ ok: false, status: 409 });
    expect(unlisted).not.toHaveProperty("openStages");
  },
);

for (const [route, operation] of [
  ["sync", documentSyncOperation],
  ["unlink", unlinkDocumentOperation],
] as const) {
  test(`a refused ${route} commit names what its stage is worth`, async () => {
    const response = Response.json(
      {
        baselineStageCode: "document_baseline_stage_headers_stale",
        code: "document_sync_baseline_group_invalid",
        error: "Document rotation baseline is not a valid group",
      },
      { status: 409 },
    );

    expect(await describeErrorResponse(response, operation)).toMatchObject({
      baselineStageCode: "document_baseline_stage_headers_stale",
      code: "document_sync_baseline_group_invalid",
    });
  });
}

test("a stage code no schema registers is not passed on", async () => {
  const body = {
    baselineStageCode: "document_baseline_stage_made_up",
    code: "document_sync_baseline_group_invalid",
    error: "Document rotation baseline is not a valid group",
  };
  expect(
    await describeErrorResponse(
      Response.json(body, { status: 409 }),
      documentSyncOperation,
    ),
  ).not.toHaveProperty("baselineStageCode");
  // A stage route's own refusals carry `code`, never the commit's hint.
  expect(
    await describeErrorResponse(
      Response.json(
        { ...body, baselineStageCode: "document_baseline_stage_expired" },
        { status: 409 },
      ),
      stageDocumentBaselineSegmentOperation,
    ),
  ).not.toHaveProperty("baselineStageCode");
});
