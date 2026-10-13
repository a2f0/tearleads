import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createOperationTransport } from "../../operationTransportFactory";
import type { OperationResponseRequestFn } from "../../types";
import { getBlobBytes } from "./get";
import { uploadMultipartBlobPartBytes } from "./multipartUpload";

const id = "11111111-1111-4111-8111-111111111111";
const bytes = new Uint8Array([1, 2, 3]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const contentMd5 = createHash("md5").update(bytes).digest("base64");
const upload = {
  byteLength: bytes.length,
  encryptedBytes: bytes,
  sha256,
  uploadId: "upload",
};

for (const direction of ["download", "upload"] as const) {
  for (const kind of ["api", "signed-url"] as const) {
    test(`${direction} propagates cancellation through ${kind} transfers`, async () => {
      const controller = new AbortController();
      let requests = 0;
      let storageFetches = 0;
      const source =
        kind === "api"
          ? { kind }
          : {
              kind,
              url: "https://storage.test/object",
              expiresAt: "2026-10-13T00:00:00.000Z",
            };
      const request: OperationResponseRequestFn = Object.assign(
        async (...args: Parameters<OperationResponseRequestFn>) => {
          const [path, , , options] = args;
          expect(options?.signal).toBe(controller.signal);
          requests += 1;
          if (path.endsWith("/download"))
            return {
              ok: true as const,
              data: Response.json({
                blobId: id,
                byteLength: bytes.length,
                sha256,
                source,
              }),
            };
          if (path.endsWith("/upload"))
            return {
              ok: true as const,
              data: Response.json({
                stageId: id,
                uploadId: upload.uploadId,
                partNumber: 1,
                byteLength: bytes.length,
                contentMd5,
                source,
              }),
            };
          const response =
            direction === "download"
              ? new Response(bytes, {
                  headers: {
                    "X-Tearleads-Blob-Id": id,
                    "X-Tearleads-Blob-Byte-Length": String(bytes.length),
                    "X-Tearleads-Blob-Sha256": sha256,
                  },
                })
              : Response.json({
                  stageId: id,
                  uploadId: upload.uploadId,
                  part: {
                    partNumber: 1,
                    byteLength: bytes.length,
                    etag: "part",
                  },
                });
          return { ok: true as const, data: response };
        },
        {
          reportFailure: (): never => {
            throw new Error("Unexpected transfer report");
          },
        },
      );
      const storageFetch = async (
        _url: string,
        options: RequestInit,
      ): Promise<Response> => {
        storageFetches += 1;
        expect(options.signal).toBe(controller.signal);
        controller.abort();
        throw new Error("Provider abort with secret URL");
      };
      const transport = createOperationTransport(request);
      const result =
        direction === "download"
          ? await getBlobBytes(transport, id, storageFetch, {
              signal: controller.signal,
            })
          : await uploadMultipartBlobPartBytes(
              transport,
              id,
              1,
              upload,
              storageFetch,
              { signal: controller.signal },
            );
      if (kind === "signed-url") {
        expect(result).toBeNull();
        expect(requests).toBe(1); // No retry/fallback after cancellation.
        expect(storageFetches).toBe(1);
      } else {
        expect(result).not.toBeNull();
        expect(requests).toBe(2);
        expect(storageFetches).toBe(0);
      }
    });
  }
}
