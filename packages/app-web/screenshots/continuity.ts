import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Resolve package assets in Node as well as Bun: Playwright runs in Node.
export const seedIdentity = JSON.parse(
  readFileSync(
    require.resolve("@a2f0/continuity/genesis/tearleads/seed.json"),
    "utf8",
  ),
) as { password: string; identitySeedPhrase: string };

export interface DocumentExpectation {
  title: string;
  imageCount: number;
}

export const seedExpectations = JSON.parse(
  readFileSync(
    require.resolve("@a2f0/continuity/genesis/tearleads/expectations.json"),
    "utf8",
  ),
) as {
  contact: { displayName: string };
  note: { title: string; bodyLine: string };
  driversLicense: DocumentExpectation;
  passport: DocumentExpectation;
  birthCertificate: DocumentExpectation;
  creditCard: DocumentExpectation;
};
