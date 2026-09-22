import { expect, test } from "bun:test";
import {
  BLOB_ENVELOPE_MAGIC_BYTES,
  BLOB_ENVELOPE_PREFIX_BYTES,
  MAX_BLOB_ENVELOPE_HEADER_BYTES,
} from "@tearleads/crypto";
import { createBlobEnvelopeFixture } from "../../../test/helpers/blobEnvelope";
import { sha256Hex } from "../../utils/sha256";
import { summarizeBlobEnvelopeStage } from "./blobEnvelopeStage";

function chunks(bytes: Uint8Array, width: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + width));
      offset += width;
    },
  });
}

test("blob stage framing survives every-byte stream boundaries", async () => {
  const fixture = await createBlobEnvelopeFixture({
    blobId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
  });
  for (const width of [1, 7, fixture.bytes.byteLength]) {
    expect(
      await summarizeBlobEnvelopeStage(chunks(fixture.bytes, width)),
    ).toEqual({
      byteLength: fixture.bytes.byteLength,
      envelopeHeader: fixture.envelopeHeader,
      sha256: sha256Hex(fixture.bytes),
    });
  }
});

test("a body shorter than the framing prefix still summarizes", async () => {
  // The header length already spans the prefix. A body smaller than that
  // prefix is the case where treating it as a payload-only length leaves the
  // header looking incomplete and rejects a perfectly valid object.
  const fixture = await createBlobEnvelopeFixture({
    blobId: crypto.randomUUID(),
    byteLength: 4,
    organizationId: crypto.randomUUID(),
  });
  expect(fixture.bytes.byteLength).toBeLessThan(
    fixture.envelopeHeader.headerByteLength + BLOB_ENVELOPE_PREFIX_BYTES,
  );
  expect(await summarizeBlobEnvelopeStage(chunks(fixture.bytes, 64))).toEqual({
    byteLength: fixture.bytes.byteLength,
    envelopeHeader: fixture.envelopeHeader,
    sha256: sha256Hex(fixture.bytes),
  });
});

test("blob stage framing rejects truncation, trailing data and noncanonical headers", async () => {
  const { bytes } = await createBlobEnvelopeFixture({
    blobId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
  });
  const noncanonical = new Uint8Array(bytes.byteLength + 1);
  noncanonical.set(bytes.subarray(0, BLOB_ENVELOPE_PREFIX_BYTES));
  noncanonical[BLOB_ENVELOPE_PREFIX_BYTES] = 32;
  noncanonical.set(
    bytes.subarray(BLOB_ENVELOPE_PREFIX_BYTES),
    BLOB_ENVELOPE_PREFIX_BYTES + 1,
  );
  new DataView(noncanonical.buffer).setUint32(
    BLOB_ENVELOPE_MAGIC_BYTES.byteLength,
    new DataView(bytes.buffer).getUint32(BLOB_ENVELOPE_MAGIC_BYTES.byteLength) +
      1,
  );
  for (const malformed of [
    bytes.subarray(0, 5),
    bytes.subarray(0, bytes.byteLength - 1),
    new Uint8Array([...bytes, 0]),
    noncanonical,
  ]) {
    await expect(
      summarizeBlobEnvelopeStage(chunks(malformed, 3)),
    ).rejects.toMatchObject({ status: 400 });
  }
});

test("an oversized blob header cancels its stream after reading the prefix", async () => {
  const prefix = new Uint8Array(BLOB_ENVELOPE_PREFIX_BYTES);
  prefix.set(BLOB_ENVELOPE_MAGIC_BYTES);
  new DataView(prefix.buffer).setUint32(
    BLOB_ENVELOPE_MAGIC_BYTES.byteLength,
    MAX_BLOB_ENVELOPE_HEADER_BYTES + 1,
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(summarizeBlobEnvelopeStage(stream)).rejects.toMatchObject({
    status: 400,
  });
  expect(cancelled).toBe(true);
});

test("a malformed header is refused without reading the whole object", async () => {
  const { bytes } = await createBlobEnvelopeFixture({
    blobId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
  });
  // Valid magic and length, invalid JSON body: rejectable from the header
  // alone. The body is large so that stopping early is unambiguous — reading
  // to the end would be needed only if the parse waited for the hash.
  const corrupt = new Uint8Array(bytes.byteLength + 1024 * 1024);
  corrupt.set(bytes);
  corrupt[BLOB_ENVELOPE_PREFIX_BYTES] = "[".charCodeAt(0);
  let delivered = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered >= corrupt.byteLength) return controller.close();
      const next = corrupt.subarray(delivered, delivered + 4096);
      delivered += next.byteLength;
      controller.enqueue(next);
    },
  });
  await expect(summarizeBlobEnvelopeStage(stream)).rejects.toMatchObject({
    status: 400,
  });
  expect(delivered).toBeLessThan(corrupt.byteLength);
});

test("a stream ending inside its header is refused", async () => {
  const { bytes } = await createBlobEnvelopeFixture({
    blobId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
  });
  await expect(
    summarizeBlobEnvelopeStage(
      chunks(bytes.subarray(0, BLOB_ENVELOPE_PREFIX_BYTES + 2), 3),
    ),
  ).rejects.toMatchObject({
    status: 400,
    message: "Blob encrypted envelope is truncated before its header",
  });
});

test("an IV that is not base64 at all is a malformed envelope, not a fault", async () => {
  // `base64ToBytes` throws its own error type here. Only structural failures
  // become a 400, so the parser has to translate this one; left alone it would
  // escape as an internal error and blame the server for the client's input.
  const { bytes } = await createBlobEnvelopeFixture({
    blobId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
  });
  // Same length as the fixture's IV, so the framing length stays correct and
  // only the IV's content is wrong. The fixture cannot build this itself: it
  // parses what it produces.
  const validIv = new TextEncoder().encode(`"iv":"${"A".repeat(16)}"`);
  const start = bytes.findIndex((_, index) =>
    validIv.every((byte, offset) => bytes[index + offset] === byte),
  );
  expect(start).toBeGreaterThan(0);
  const corrupt = new Uint8Array(bytes);
  corrupt.set(new TextEncoder().encode(`"iv":"${"!".repeat(16)}"`), start);
  await expect(
    summarizeBlobEnvelopeStage(chunks(corrupt, 64)),
  ).rejects.toMatchObject({
    status: 400,
    message: "Blob encrypted bytes IV is invalid",
  });
});
