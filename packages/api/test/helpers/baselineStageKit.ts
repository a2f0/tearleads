// What the staged rotation baseline tests share: the stage routes as a
// writer calls them, and a signed group cut into a staged part and the final
// segment the committing request carries.
import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentBaselineStages,
} from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/test-utils";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import type { DocumentBaselineStageStatusResponse } from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { CONTENT_KEY_COMMITMENT_FIXTURE } from "./documentEnvelopeFixture";

function stageRequest(
  owner: TestUser,
  method: "DELETE" | "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
) {
  return routeApp.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${owner.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function openStage(
  owner: TestUser,
  documentId: string,
  stage: {
    readonly baselineId: string;
    readonly contentKeyCommitment?: string | undefined;
    readonly contentKeyEpoch: number;
  },
) {
  return stageRequest(
    owner,
    "POST",
    `/documents/${documentId}/baseline-stages`,
    {
      baselineId: stage.baselineId,
      contentKeyCommitment:
        stage.contentKeyCommitment ?? CONTENT_KEY_COMMITMENT_FIXTURE,
      contentKeyEpoch: stage.contentKeyEpoch,
    },
  );
}

function stagePath(documentId: string, baselineId: string): string {
  return `/documents/${documentId}/baseline-stages/${baselineId}`;
}

export function getStage(
  owner: TestUser,
  documentId: string,
  baselineId: string,
) {
  return stageRequest(owner, "GET", stagePath(documentId, baselineId));
}

export function abandonStage(
  owner: TestUser,
  documentId: string,
  baselineId: string,
) {
  return stageRequest(owner, "DELETE", stagePath(documentId, baselineId));
}

/** Stages `segment` at `index`, by default the index it signs. */
export function putSegment(
  owner: TestUser,
  documentId: string,
  segment: DocumentOutgoingUpdate,
  at?: { readonly baselineId?: string; readonly index?: number },
) {
  const baselineId = at?.baselineId ?? segment.baselineId ?? "";
  const index = at?.index ?? segment.baselineSegmentIndex ?? 0;
  return stageRequest(
    owner,
    "PUT",
    `${stagePath(documentId, baselineId)}/segments/${index}`,
    segment,
  );
}

export function putSegmentHeader(
  owner: TestUser,
  documentId: string,
  baselineId: string,
  index: number,
  writeHeader: unknown,
) {
  return stageRequest(
    owner,
    "PUT",
    `${stagePath(documentId, baselineId)}/segments/${index}/write-header`,
    { writeHeader },
  );
}

/**
 * Open a stage for `group` and stage every segment but its final one, as a
 * writer does before the request that rotates. Returns the final segment,
 * which that request carries, and the stage as the last upload left it.
 */
export async function stageAllButFinal(
  owner: TestUser,
  documentId: string,
  group: readonly DocumentOutgoingUpdate[],
  stage: {
    readonly contentKeyCommitment?: string | undefined;
    readonly contentKeyEpoch: number;
  },
): Promise<{
  readonly baselineStageId: string;
  readonly final: DocumentOutgoingUpdate;
  readonly staged: readonly DocumentOutgoingUpdate[];
  readonly status: DocumentBaselineStageStatusResponse;
}> {
  const final = group.at(-1);
  const baselineStageId = final?.baselineId;
  if (!final || baselineStageId === undefined) {
    throw new Error("Expected a signed baseline group");
  }
  const opened = await openStage(owner, documentId, {
    ...stage,
    baselineId: baselineStageId,
  });
  expect(opened.status).toBe(200);
  let status: DocumentBaselineStageStatusResponse = await opened.json();
  const staged = group.slice(0, -1);
  for (const segment of staged) {
    const response = await putSegment(owner, documentId, segment);
    expect(response.status).toBe(200);
    status = await response.json();
  }
  expect(status.nextSegmentIndex).toBe(staged.length);
  return { baselineStageId, final, staged, status };
}

/** The stage rows and staged rows a document holds, for what a refusal left. */
export async function stagedRows(documentId: string) {
  const [stages, segments, spans] = await Promise.all([
    db
      .select({
        id: documentBaselineStages.id,
        nextSegmentIndex: documentBaselineStages.nextSegmentIndex,
      })
      .from(documentBaselineStages)
      .where(eq(documentBaselineStages.documentId, documentId)),
    db
      .select({
        baselineId: documentBaselineSegments.baselineId,
        segmentIndex: documentBaselineSegments.segmentIndex,
        updateId: documentBaselineSegments.updateId,
      })
      .from(documentBaselineSegments)
      .where(eq(documentBaselineSegments.documentId, documentId))
      .orderBy(
        asc(documentBaselineSegments.baselineId),
        asc(documentBaselineSegments.segmentIndex),
      ),
    db
      .select({ updateId: documentBaselineSegmentSpans.updateId })
      .from(documentBaselineSegmentSpans)
      .where(eq(documentBaselineSegmentSpans.documentId, documentId)),
  ]);
  return { segments, spans, stages };
}

/** Moves a stage's expiry, as time passing would. */
export async function setStageExpiry(
  documentId: string,
  baselineId: string,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(documentBaselineStages)
    .set({ expiresAt })
    .where(
      and(
        eq(documentBaselineStages.documentId, documentId),
        eq(documentBaselineStages.id, baselineId),
      ),
    );
}
