import { expect, test } from "bun:test";

import {
  createSeedPhraseFileName,
  parseSeedPhraseFileText,
} from "./seedPhraseBackup";

test("seed phrase backup file names can be timestamped deterministically", () => {
  const fileName = createSeedPhraseFileName({
    signingFingerprint: "abcdef1234567890",
    timestamp: new Date("2026-07-07T22:15:30.000Z"),
  });

  expect(fileName).toBe(
    "tearleads-seed-phrase-abcdef123456-2026-07-07T22-15-30.000Z.txt",
  );
});

test("seed phrase file parsing trims surrounding whitespace", () => {
  expect(parseSeedPhraseFileText("\n abandon ability \n")).toBe(
    "abandon ability",
  );
});
