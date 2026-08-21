import type { ListDocumentEditAttributionRangesResponse } from "@symcrypt/validators/response";
import {
  type ComputedDocumentEditAttribution,
  createDocumentEditAttributionRangesPage,
  createDocumentEditAttributionResponse,
  DocumentEditAttributionError,
  type PreparedDocumentEditAttribution,
  runPrepareDocumentEditAttributionWorkflow,
  runPreparedDocumentEditAttributionDataWorkflow,
  validateDocumentEditAttributionRangesRequest,
} from "../../workflows/documents/documentEditAttribution";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import type { ApiServiceRuntime } from "../runtime";
import {
  documentEditAttributionCacheKey,
  getCachedDocumentEditAttribution,
  getCachedDocumentEditAttributionData,
  type SerializedDocumentEditAttribution,
  setCachedDocumentEditAttribution,
  setCachedDocumentEditAttributionData,
} from "./documentEditAttributionCache";

interface DocumentEditAttributionInput {
  documentId: string;
  userId: string;
}

interface ListDocumentEditAttributionRangesInput
  extends DocumentEditAttributionInput {
  cursor?: string | undefined;
  expectedRevision?: number | undefined;
  limit?: number | undefined;
}

export { DocumentEditAttributionError };

export const prepareDocumentEditAttribution = createDatabaseWorkflowService<
  DocumentEditAttributionInput,
  PreparedDocumentEditAttribution
>(runPrepareDocumentEditAttributionWorkflow);

interface AttributionInFlightState {
  readonly attribution: Map<string, Promise<SerializedDocumentEditAttribution>>;
  readonly data: Map<string, Promise<ComputedDocumentEditAttribution>>;
}

const inFlightByRuntime = new WeakMap<
  ApiServiceRuntime,
  AttributionInFlightState
>();

function inFlightState(runtime: ApiServiceRuntime): AttributionInFlightState {
  const existing = inFlightByRuntime.get(runtime);
  if (existing) {
    return existing;
  }
  const created = {
    attribution: new Map<string, Promise<SerializedDocumentEditAttribution>>(),
    data: new Map<string, Promise<ComputedDocumentEditAttribution>>(),
  };
  inFlightByRuntime.set(runtime, created);
  return created;
}

async function loadPreparedDocumentEditAttributionData(
  runtime: ApiServiceRuntime,
  prepared: PreparedDocumentEditAttribution,
): Promise<ComputedDocumentEditAttribution> {
  const cached = getCachedDocumentEditAttributionData(prepared, runtime);
  if (cached) {
    return cached;
  }

  const key = documentEditAttributionCacheKey(prepared);
  const inFlight = inFlightState(runtime).data;
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }
  const pending = runPreparedDocumentEditAttributionDataWorkflow(
    runtime.db,
    prepared,
  ).then((attribution) =>
    setCachedDocumentEditAttributionData(attribution, prepared, runtime),
  );
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  }
}

export async function loadPreparedDocumentEditAttribution(
  runtime: ApiServiceRuntime,
  prepared: PreparedDocumentEditAttribution,
): Promise<SerializedDocumentEditAttribution> {
  const cached = getCachedDocumentEditAttribution(prepared, runtime);
  if (cached) {
    return cached;
  }

  const key = documentEditAttributionCacheKey(prepared);
  const inFlight = inFlightState(runtime).attribution;
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }
  const pending = loadPreparedDocumentEditAttributionData(runtime, prepared)
    .then(createDocumentEditAttributionResponse)
    .then((response) =>
      setCachedDocumentEditAttribution(response, prepared, runtime),
    );
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) {
      inFlight.delete(key);
    }
  }
}

export async function listDocumentEditAttributionRanges(
  runtime: ApiServiceRuntime,
  input: ListDocumentEditAttributionRangesInput,
): Promise<ListDocumentEditAttributionRangesResponse> {
  const prepared = await prepareDocumentEditAttribution(runtime, input);
  validateDocumentEditAttributionRangesRequest(prepared, input);
  const attribution = await loadPreparedDocumentEditAttributionData(
    runtime,
    prepared,
  );
  return createDocumentEditAttributionRangesPage(attribution, input);
}
