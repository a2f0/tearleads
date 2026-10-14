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

export interface EquipmentExpectation extends DocumentExpectation {
  fields: { make: string; model: string; serialNumber: string };
}

export interface TrackerExpectation {
  title: string;
  rowCount: number;
  rows: ReadonlyArray<Record<string, string>>;
}

export const seedExpectations = JSON.parse(
  readFileSync(
    require.resolve("@a2f0/continuity/genesis/tearleads/expectations.json"),
    "utf8",
  ),
) as {
  schemaVersion: number;
  contact: { displayName: string };
  note: { title: string; bodyLine: string };
  driversLicense: DocumentExpectation;
  passport: DocumentExpectation;
  birthCertificate: DocumentExpectation;
  creditCard: DocumentExpectation;
  photos: DocumentExpectation[];
  tools: EquipmentExpectation[];
  appliances: EquipmentExpectation[];
  weight: TrackerExpectation;
  bloodPressure: TrackerExpectation;
};

if (
  seedExpectations.schemaVersion !== 2 ||
  seedExpectations.photos.length < 2 ||
  seedExpectations.tools.length < 2 ||
  seedExpectations.appliances.length < 2 ||
  seedExpectations.weight.rowCount < 2 ||
  seedExpectations.bloodPressure.rowCount < 2
) {
  throw new Error(
    "Continuity does not provide the required screenshot coverage.",
  );
}
