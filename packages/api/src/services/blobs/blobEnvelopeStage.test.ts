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
