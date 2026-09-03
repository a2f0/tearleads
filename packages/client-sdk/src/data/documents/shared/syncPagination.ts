import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { parseWalLsn } from "@tearleads/validators/util";
import type {
  DocumentSyncCommitLsnMode,
  DocumentSyncPullContinuation,
} from "./pullContinuation";
import type {
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
} from "./types";

export type {
  DocumentSyncCommitLsnMode,
  DocumentSyncPullContinuation,
} from "./pullContinuation";
export { documentSyncPullContinuationsEqual } from "./pullContinuation";

export class InvalidDocumentSyncPullContinuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentSyncPullContinuationError";
  }
}

type DocumentSyncPageSubmission =
  | {
      readonly ok: true;
      readonly response: DocumentSyncResponse;
    }
  | DocumentSyncSubmitFailure
  | null;

type DocumentSyncSubmission =
  | {
      readonly ok: true;
      readonly pullComplete: boolean;
      readonly response: DocumentSyncResponse;
    }
  | DocumentSyncSubmitFailure
  | null;

function documentSyncCommitLsnMode(
  response: DocumentSyncResponse,
): DocumentSyncCommitLsnMode {
  return response.commitLsnMode === "untracked" ? "untracked" : "tracked";
}

export function readPullContinuation(
  response: DocumentSyncResponse,
): DocumentSyncPullContinuation | null {
  const cursor = requirePullPage(response).nextCursor;
  if (cursor === null) return null;
  if (response.commitLsn === null) {
    throw new Error(
      "Document sync pull continuation is missing its checkpoint",
    );
  }
  return {
    commitLsn: response.commitLsn,
    commitLsnMode: documentSyncCommitLsnMode(response),
    cursor,
  };
}

export function resolvePullContinuationMinLsn(
  continuation: DocumentSyncPullContinuation | undefined,
  fallback: string | undefined,
): string | undefined {
  if (!continuation) return fallback;
  if (continuation.commitLsnMode === "untracked" || fallback === undefined) {
    return continuation.commitLsn;
  }
  return parseWalLsn(continuation.commitLsn) >= parseWalLsn(fallback)
    ? continuation.commitLsn
    : fallback;
}

function assertPageCheckpoint(input: {
  readonly minLsn: string | undefined;
  readonly nextCursor: string | null;
  readonly response: DocumentSyncResponse;
}): void {
  if (input.response.commitLsnMode === "untracked") {
    if (input.response.commitLsn !== "0/0") {
      throw new InvalidDocumentSyncPullContinuationError(
        "Document sync continuation untracked LSN is invalid",
      );
    }
    return;
  }
  if (input.response.commitLsn === null) {
    if (input.minLsn === undefined && input.nextCursor === null) return;
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync pull continuation is missing its checkpoint",
    );
  }
  let responseLsn: bigint;
  try {
    responseLsn = parseWalLsn(input.response.commitLsn);
  } catch {
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync continuation commit LSN is invalid",
    );
  }
  if (input.minLsn === undefined) return;
  let minimumLsn: bigint;
  try {
    minimumLsn = parseWalLsn(input.minLsn);
  } catch {
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync minimum commit LSN is invalid",
    );
  }
  if (responseLsn < minimumLsn) {
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync continuation commit LSN regressed",
    );
  }
}

function requirePullPage(response: DocumentSyncResponse) {
  if (response.pullPage === undefined) {
    throw new Error("Document sync response is missing pull page metadata");
  }
  return response.pullPage;
}

async function submitDocumentSyncPage(input: {
  readonly expectedCommitLsnMode?: DocumentSyncCommitLsnMode | undefined;
  readonly plan: DocumentSyncPlan;
  readonly submit: () => Promise<DocumentSyncPageSubmission>;
}): Promise<DocumentSyncSubmission> {
  const page = await input.submit();
  if (!page || !page.ok) return page;
  if (
    input.expectedCommitLsnMode !== undefined &&
    documentSyncCommitLsnMode(page.response) !== input.expectedCommitLsnMode
  ) {
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync continuation commit LSN mode changed",
    );
  }
  const nextCursor = requirePullPage(page.response).nextCursor;
  assertPageCheckpoint({
    minLsn: input.plan.request.minLsn,
    nextCursor,
    response: page.response,
  });
  if (nextCursor !== null && page.response.commitLsn === null) {
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync pull continuation is missing its checkpoint",
    );
  }
  if (nextCursor !== null && nextCursor === input.plan.request.pullCursor) {
    throw new InvalidDocumentSyncPullContinuationError(
      "Document sync continuation cursor did not advance",
    );
  }
  return {
    ok: true,
    pullComplete: nextCursor === null,
    response: page.response,
  };
}

export async function submitDocumentSync(input: {
  apiClient: DocumentSyncApi;
  expectedCommitLsnMode?: DocumentSyncCommitLsnMode | undefined;
  plan: DocumentSyncPlan;
}): Promise<DocumentSyncSubmission> {
  return submitDocumentSyncPage({
    expectedCommitLsnMode: input.expectedCommitLsnMode,
    plan: input.plan,
    submit: async () => {
      if (input.apiClient.syncDocumentResult) {
        const result = await input.apiClient.syncDocumentResult(
          input.plan.documentId,
          input.plan.request,
          {
            expectedPaymentRequiredOrganizationId: input.plan.organizationId,
            reportErrors: false,
          },
        );
        return result.ok ? { ok: true, response: result.data } : result;
      }

      const response = await input.apiClient.syncDocument(
        input.plan.documentId,
        input.plan.request,
        {
          expectedPaymentRequiredOrganizationId: input.plan.organizationId,
        },
      );
      return response ? { ok: true, response } : null;
    },
  });
}
