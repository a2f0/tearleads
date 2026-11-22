import { afterEach, expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { installPrintFrameStub } from "../../test/helpers/printFrameTestKit";
import { printRecoveryKey } from "./recoveryKeyPrint";

const seedPhrase = createIdentitySeedPhraseFromEntropy(
  new Uint8Array(32).fill(0x31),
);
let stub: ReturnType<typeof installPrintFrameStub> | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
});

function printFrames() {
  return document.querySelectorAll('iframe[aria-hidden="true"]');
}

test("prints the numbered words, the QR code, and the identity on their own sheet", () => {
  stub = installPrintFrameStub();

  printRecoveryKey({ seedPhrase, signingFingerprint: "fingerprint-123" });

  expect(stub.printed).toHaveLength(1);
  const sheet = stub.printed[0];
  if (!sheet) throw new Error("Expected a printed sheet.");
  expect(
    Array.from(sheet.querySelectorAll("ol li"), (word) => word.textContent),
  ).toEqual(seedPhrase.split(" "));
  expect(sheet.querySelector("svg")?.namespaceURI).toBe(
    "http://www.w3.org/2000/svg",
  );
  expect(sheet.querySelector("svg path")).toBeTruthy();
  expect(sheet.body.textContent).toContain("fingerprint-123");
  // The sheet replaces whatever the frame held, so nothing else prints.
  expect(Array.from(sheet.body.children, (child) => child.tagName)).toEqual([
    "MAIN",
  ]);
});

test("removes the frame, and the key in it, once the print dialog closes", () => {
  stub = installPrintFrameStub();

  printRecoveryKey({ seedPhrase, signingFingerprint: null });
  const [frame] = printFrames();
  expect(frame).toBeTruthy();
  if (!(frame instanceof HTMLIFrameElement)) throw new Error("No frame.");

  frame.contentWindow?.dispatchEvent(new Event("afterprint"));
  expect(printFrames()).toHaveLength(0);
});

test("a later print replaces a frame whose dialog never reported closing", () => {
  stub = installPrintFrameStub();

  printRecoveryKey({ seedPhrase, signingFingerprint: null });
  printRecoveryKey({ seedPhrase, signingFingerprint: null });

  expect(stub.printed).toHaveLength(2);
  expect(printFrames()).toHaveLength(1);
});

test("leaves no frame behind when the frame has no window to print", () => {
  stub = installPrintFrameStub({ frameWindow: false });

  expect(() =>
    printRecoveryKey({ seedPhrase, signingFingerprint: null }),
  ).toThrow("Printing is unavailable on this device.");
  expect(printFrames()).toHaveLength(0);
});
