import type {
  DocumentBaselineStageOpenRequest,
  DocumentBaselineStageWriteHeaderRequest,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import type {
  DocumentBaselineStageAbandonResponse,
  DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";

/** What a stage request is sent with, as every document request is. */
interface DocumentBaselineStageRequestOptions {
  readonly expectedPaymentRequiredOrganizationId?: string | undefined;
  readonly reportErrors?: boolean | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}

/** A refused or failed stage request, with the stage's code if it sent one. */
export interface DocumentBaselineStageFailure {
  readonly code?: string | undefined;
  readonly message: string;
  /** With `segment_out_of_order`: the index the stage expects next. */
  readonly nextSegmentIndex?: number | undefined;
  readonly ok: false;
  readonly status: number | null;
}

type DocumentBaselineStageResult<T> =
  | { readonly data: T; readonly ok: true }
  | DocumentBaselineStageFailure;

type StageStatusResult = Promise<
  DocumentBaselineStageResult<DocumentBaselineStageStatusResponse>
>;

/**
 * The stage routes a writer uploads a rotation baseline through when its
 * history does not fit the request that rotates: open, read, abandon, stage
 * one segment, and re-sign one staged header. The API client satisfies it.
 */
export interface DocumentBaselineStageApi {
  openDocumentBaselineStageResult(
    documentId: string,
    input: DocumentBaselineStageOpenRequest,
    options?: DocumentBaselineStageRequestOptions,
  ): StageStatusResult;
  getDocumentBaselineStageResult(
    documentId: string,
    baselineId: string,
    options?: DocumentBaselineStageRequestOptions,
  ): StageStatusResult;
  abandonDocumentBaselineStageResult(
    documentId: string,
    baselineId: string,
    options?: DocumentBaselineStageRequestOptions,
  ): Promise<DocumentBaselineStageResult<DocumentBaselineStageAbandonResponse>>;
  stageDocumentBaselineSegmentResult(
    documentId: string,
    baselineId: string,
    segmentIndex: number,
    segment: DocumentOutgoingUpdate,
    options?: DocumentBaselineStageRequestOptions,
  ): StageStatusResult;
  resignDocumentBaselineSegmentHeaderResult(
    documentId: string,
    baselineId: string,
    segmentIndex: number,
    input: DocumentBaselineStageWriteHeaderRequest,
    options?: DocumentBaselineStageRequestOptions,
  ): StageStatusResult;
}

/**
 * The stage routes of an API port that may lack them, or null. A host whose
 * client cannot stage sends every baseline whole, and a history too large
 * for that cannot rotate from it.
 */
export function documentBaselineStageApi(
  api: Partial<DocumentBaselineStageApi>,
): DocumentBaselineStageApi | null {
  const {
    abandonDocumentBaselineStageResult,
    getDocumentBaselineStageResult,
    openDocumentBaselineStageResult,
    resignDocumentBaselineSegmentHeaderResult,
    stageDocumentBaselineSegmentResult,
  } = api;
  if (
    !abandonDocumentBaselineStageResult ||
    !getDocumentBaselineStageResult ||
    !openDocumentBaselineStageResult ||
    !resignDocumentBaselineSegmentHeaderResult ||
    !stageDocumentBaselineSegmentResult
  ) {
    return null;
  }
  return {
    abandonDocumentBaselineStageResult:
      abandonDocumentBaselineStageResult.bind(api),
    getDocumentBaselineStageResult: getDocumentBaselineStageResult.bind(api),
    openDocumentBaselineStageResult: openDocumentBaselineStageResult.bind(api),
    resignDocumentBaselineSegmentHeaderResult:
      resignDocumentBaselineSegmentHeaderResult.bind(api),
    stageDocumentBaselineSegmentResult:
      stageDocumentBaselineSegmentResult.bind(api),
  };
}
