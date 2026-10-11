/**
 * An S3 impostor for Worker tests: path-style multipart uploads, object reads
 * and deletes, with the XML answers the SDK parses. Requests are not
 * authenticated; `requests` records what the client sent.
 */
export interface FakeS3 {
  readonly endpoint: string;
  readonly requests: () => readonly string[];
  readonly objects: () => ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  readonly stop: () => void;
}

interface Upload {
  readonly key: string;
  readonly parts: Map<number, Uint8Array<ArrayBuffer>>;
}

function xml(body: string, status = 200): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status,
    headers: { "content-type": "application/xml" },
  });
}

function s3Error(code: string, status: number): Response {
  return xml(
    `<Error><Code>${code}</Code><Message>${code}</Message></Error>`,
    status,
  );
}

async function etagOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `"${hex.slice(0, 32)}"`;
}

export function startFakeS3(): FakeS3 {
  const requests: string[] = [];
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const uploads = new Map<string, Upload>();
  let nextUpload = 1;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const [, , ...keyParts] = url.pathname.split("/");
      const key = decodeURIComponent(keyParts.join("/"));
      const params = url.searchParams;
      requests.push(
        `${request.method} ${url.pathname}${params.has("uploads") ? "?uploads" : ""}${params.has("uploadId") ? "?uploadId" : ""}${params.has("partNumber") ? "&partNumber" : ""}`,
      );
      if (request.method === "POST" && params.has("uploads")) {
        const uploadId = `upload-${nextUpload++}`;
        uploads.set(uploadId, { key, parts: new Map() });
        return xml(
          `<InitiateMultipartUploadResult><Bucket>fake</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
        );
      }
      const uploadId = params.get("uploadId");
      const upload = uploadId ? uploads.get(uploadId) : undefined;
      if (uploadId && !upload) {
        return s3Error("NoSuchUpload", 404);
      }
      if (upload && request.method === "PUT") {
        const bytes = new Uint8Array(await request.arrayBuffer());
        upload.parts.set(Number(params.get("partNumber")), bytes);
        return new Response(null, {
          status: 200,
          headers: { etag: await etagOf(bytes) },
        });
      }
      if (upload && request.method === "GET") {
        const parts = await Promise.all(
          [...upload.parts].map(
            async ([number, bytes]) =>
              `<Part><PartNumber>${number}</PartNumber><ETag>${await etagOf(bytes)}</ETag><Size>${bytes.byteLength}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Part>`,
          ),
        );
        return xml(
          `<ListPartsResult><Bucket>fake</Bucket><Key>${upload.key}</Key><UploadId>${uploadId}</UploadId><IsTruncated>false</IsTruncated>${parts.join("")}</ListPartsResult>`,
        );
      }
      if (upload && request.method === "POST") {
        const body = await request.text();
        const ordered = [
          ...body.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g),
        ].map((match) => Number(match[1]));
        const chunks = ordered.map((number) => upload.parts.get(number));
        if (chunks.some((chunk) => chunk === undefined)) {
          return s3Error("InvalidPart", 400);
        }
        const assembled = new Uint8Array(
          new ArrayBuffer(
            chunks.reduce(
              (total, chunk) => total + (chunk?.byteLength ?? 0),
              0,
            ),
          ),
        );
        let offset = 0;
        for (const chunk of chunks) {
          if (chunk) {
            assembled.set(chunk, offset);
            offset += chunk.byteLength;
          }
        }
        objects.set(upload.key, assembled);
        uploads.delete(String(uploadId));
        return xml(
          `<CompleteMultipartUploadResult><Location>${url.origin}/fake/${upload.key}</Location><Bucket>fake</Bucket><Key>${upload.key}</Key><ETag>${await etagOf(assembled)}</ETag></CompleteMultipartUploadResult>`,
        );
      }
      if (upload && request.method === "DELETE") {
        uploads.delete(String(uploadId));
        return new Response(null, { status: 204 });
      }
      const object = objects.get(key);
      if (request.method === "GET" || request.method === "HEAD") {
        if (!object) {
          return s3Error("NoSuchKey", 404);
        }
        return new Response(request.method === "HEAD" ? null : object, {
          status: 200,
          headers: {
            "content-length": String(object.byteLength),
            etag: await etagOf(object),
          },
        });
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return s3Error("NotImplemented", 501);
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    requests: () => requests,
    objects: () => objects,
    stop: () => {
      server.stop(true);
    },
  };
}
