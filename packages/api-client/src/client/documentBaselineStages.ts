import {
  abandonDocumentBaselineStageOperation,
  getDocumentBaselineStageOperation,
  openDocumentBaselineStageOperation,
  resignDocumentBaselineSegmentHeaderOperation,
  stageDocumentBaselineSegmentOperation,
} from "@tearleads/validators/operation";
import type {
  DocumentBaselineStageOpenRequest,
  DocumentBaselineStageWriteHeaderRequest,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import type {
  DocumentBaselineStageAbandonResponse,
  DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";
import { bindPrototypeMethods } from "../requestInternals";
import type { RequestResult, RequestResultOptions } from "../types";
import type { ApiClientContext } from "./apiClientContext";

type StageStatusResult = Promise<
  RequestResult<DocumentBaselineStageStatusResponse>
>;

/**
 * The stage of a rotation baseline too large for one request: its writer
 * opens it, uploads every segment but the final one in index order, and
 * names it in the unlink or sync that rotates. Nothing staged is an update
 * of the document, so no call here touches a cached projection or the
 * document's attribution; the request that commits the stage does.
 *
 * Every call returns its failure, with the stage's own code when the API
 * sent one. A segment refused out of order also carries the index the stage
 * expects next (`RequestFailure.nextSegmentIndex`).
 */
export class DocumentBaselineStageArea {
  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, DocumentBaselineStageArea.prototype);
  }

  openDocumentBaselineStageResult(
    documentId: string,
    input: DocumentBaselineStageOpenRequest,
    options: RequestResultOptions = {},
  ): StageStatusResult {
    return this.context.transport.requestResult(
      openDocumentBaselineStageOperation,
      { body: input, params: { documentId } },
      options,
    );
  }

  getDocumentBaselineStageResult(
    documentId: string,
    baselineId: string,
    options: RequestResultOptions = {},
  ): StageStatusResult {
    return this.context.transport.requestResult(
      getDocumentBaselineStageOperation,
      { params: { baselineId, documentId } },
      options,
    );
  }

  abandonDocumentBaselineStageResult(
    documentId: string,
    baselineId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentBaselineStageAbandonResponse>> {
    return this.context.transport.requestResult(
      abandonDocumentBaselineStageOperation,
      { params: { baselineId, documentId } },
      options,
    );
  }

  stageDocumentBaselineSegmentResult(
    documentId: string,
    baselineId: string,
    segmentIndex: number,
    segment: DocumentOutgoingUpdate,
    options: RequestResultOptions = {},
  ): StageStatusResult {
    return this.context.transport.requestResult(
      stageDocumentBaselineSegmentOperation,
      { body: segment, params: { baselineId, documentId, segmentIndex } },
      options,
    );
  }

  resignDocumentBaselineSegmentHeaderResult(
    documentId: string,
    baselineId: string,
    segmentIndex: number,
    input: DocumentBaselineStageWriteHeaderRequest,
    options: RequestResultOptions = {},
  ): StageStatusResult {
    return this.context.transport.requestResult(
      resignDocumentBaselineSegmentHeaderOperation,
      { body: input, params: { baselineId, documentId, segmentIndex } },
      options,
    );
  }
}
