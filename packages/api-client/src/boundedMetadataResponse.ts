import {
  type HttpOperation,
  logoutOperation,
  verifyOperation,
} from "@tearleads/validators/operation";
import { MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES } from "@tearleads/validators/util";
/** Only a streaming host sets this option on the requests used for bounded blob reads. */
export class MetadataSizeError extends Error {}
export const boundedMetadata = Symbol("boundedMetadata");
const MAX_METADATA_BYTES = 64 * 1024;
// A binding list carries signatures and recipient envelopes for multiple slots.
const MAX_ATTACHMENT_LIST_BYTES = 8 * 1024 * 1024;
export type MetadataLimit =
  | "all"
  | "errors"
  | "attachment-list"
  | "writer-projection"
  | "document-sync"
  | "verification-page";

const metadataLimits: Record<MetadataLimit, number> = {
  all: MAX_METADATA_BYTES,
  errors: MAX_METADATA_BYTES,
  "attachment-list": MAX_ATTACHMENT_LIST_BYTES,
  "writer-projection": MAX_ATTACHMENT_LIST_BYTES,
  "document-sync": MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
  "verification-page": MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
};

/** The verifier accumulates discovery and document history locally. Bound all JSON reads together. */
export function createSessionMetadataReader(
  verification: boolean,
  sessionLimit = 2 * MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES,
) {
  let remainingMetadataBytes = sessionLimit;
  const budget = {
    available: () => remainingMetadataBytes > 0,
    consume(bytes: number) {
      remainingMetadataBytes -= bytes;
      return remainingMetadataBytes >= 0;
    },
  };
  return (
    response: Response,
    options: Parameters<typeof boundedMetadataResponse>[1],
    operation: HttpOperation,
  ) =>
    boundedMetadataResponse(
      response,
      options,
      verification &&
        operation !== logoutOperation &&
        operation !== verifyOperation
        ? budget
        : undefined,
    );
}

/** Limit JSON descriptors and HTTP error details before any decoder can buffer them. */
export function boundedMetadataResponse(
  response: Response,
  options: { readonly [boundedMetadata]?: MetadataLimit | undefined },
  budget?: { available(): boolean; consume(bytes: number): boolean },
): Response {
  const mode = options[boundedMetadata];
  if (!mode || (mode === "errors" && response.ok) || response.status < 200)
    return response;
  const init = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
  const reader = response.body?.getReader();
  if (!reader) return new Response(null, init);
  const limit = metadataLimits[mode];
  let bytes = 0;
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            if (bytes === 0 && budget?.available() === false)
              throw new MetadataSizeError(
                "Blob response metadata exceeds its size limit",
              );
            const next = await reader.read();
            if (next.done) {
              reader.releaseLock();
              controller.close();
              return;
            }
            bytes += next.value.byteLength;
            if (
              budget?.consume(next.value.byteLength) === false ||
              bytes > limit
            ) {
              throw new MetadataSizeError(
                "Blob response metadata exceeds its size limit",
              );
            }
            controller.enqueue(next.value);
          } catch (error) {
            void reader.cancel().catch(() => {});
            reader.releaseLock();
            controller.error(error);
          }
        },
        cancel(reason) {
          void reader.cancel(reason).catch(() => {});
          reader.releaseLock();
        },
      },
      { highWaterMark: 0 },
    ),
    init,
  );
}
