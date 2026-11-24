import { afterEach, expect, spyOn, test } from "bun:test";
import { openAesGcmRecord } from "./aesGcmRecordOpening";

const additionalData = new TextEncoder().encode("record-associated-data");
const realDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
const restorers: (() => void)[] = [];

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
});

function bytesOf(source: BufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

/** A 1 KiB record sealed under a fresh key, as a writer seals one. */
async function sealedRecord() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = crypto.getRandomValues(new Uint8Array(1024));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      key,
      plaintext,
    ),
  );
  const open = (
    sealed: Uint8Array<ArrayBuffer> = ciphertext,
    buildCanary?: (length: number) => Uint8Array<ArrayBuffer>,
  ) =>
    openAesGcmRecord(
      {
        additionalData,
        ciphertext: sealed,
        decryptKey: key,
        encryptKey: async () => key,
        iv,
      },
      buildCanary,
    );
  return { ciphertext, iv, open, plaintext };
}

/** Replaces `crypto.subtle.decrypt` until the test ends. */
function decryptAs(
  fake: (
    iv: Uint8Array,
    data: Uint8Array,
    real: () => Promise<ArrayBuffer>,
  ) => Promise<ArrayBuffer>,
) {
  const spy = spyOn(crypto.subtle, "decrypt").mockImplementation(
    (algorithm, key, data) =>
      fake(bytesOf((algorithm as AesGcmParams).iv), bytesOf(data), () =>
        realDecrypt(algorithm, key, data),
      ),
  );
  restorers.push(() => spy.mockRestore());
}

const backendFault = () =>
  Promise.reject(new DOMException("backend", "OperationError"));

test("an intact record opens", async () => {
  const record = await sealedRecord();
  const opening = await record.open();
  expect(opening.status).toBe("opened");
  expect(opening.status === "opened" && opening.plaintext).toEqual(
    record.plaintext,
  );
});

/** A canary builder that records the length of each canary it builds. */
function countingCanaries() {
  const lengths: number[] = [];
  const build = (length: number) => {
    lengths.push(length);
    return new Uint8Array(length).fill(0x5a);
  };
  return { build, lengths };
}

function tamperedCopy(ciphertext: Uint8Array<ArrayBuffer>) {
  const tampered = new Uint8Array(ciphertext);
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  return tampered;
}

test("a record that opens builds no canary", async () => {
  const record = await sealedRecord();
  const canaries = countingCanaries();
  expect((await record.open(record.ciphertext, canaries.build)).status).toBe(
    "opened",
  );
  expect(canaries.lengths).toEqual([]);
});

test("a record whose tag fails is refused once canaries round-trip", async () => {
  const record = await sealedRecord();
  const canaries = countingCanaries();
  const opening = await record.open(
    tamperedCopy(record.ciphertext),
    canaries.build,
  );
  expect(opening.status).toBe("refused");
  // One canary the size of the record's plaintext serves both round trips.
  expect(canaries.lengths).toEqual([record.plaintext.length]);
});

test("a canary this runtime cannot build is the runtime's", async () => {
  const record = await sealedRecord();
  const opening = await record.open(tamperedCopy(record.ciphertext), () => {
    throw new RangeError("Array buffer allocation failed");
  });
  expect(opening.status).toBe("runtime");
});

test("a fault that hits every buffer the record's size is the runtime's", async () => {
  const record = await sealedRecord();
  decryptAs((_iv, data, real) =>
    data.length >= record.ciphertext.length ? backendFault() : real(),
  );
  expect((await record.open()).status).toBe("runtime");
});

test("a fault that outlasts the first canary is the runtime's", async () => {
  const record = await sealedRecord();
  let canaries = 0;
  decryptAs((iv, _data, real) => {
    if (sameBytes(iv, record.iv)) return backendFault();
    canaries += 1;
    return canaries === 1 ? real() : backendFault();
  });
  expect((await record.open()).status).toBe("runtime");
  expect(canaries).toBe(2);
});
