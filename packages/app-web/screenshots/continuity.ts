import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Resolve package assets in Node as well as Bun: Playwright runs in Node.
export const seedIdentity = JSON.parse(
  readFileSync(
    require.resolve("@a2f0/continuity/genesis/tearleads/seed.json"),
    "utf8",
  ),
) as { identitySeedPhrase: string };

export interface DocumentExpectation {
  title: string;
  imageCount: number;
}

export interface EquipmentExpectation extends DocumentExpectation {
  fields: { make: string; model: string; serialNumber: string };
  /** The photo the item shows as its avatar. */
  avatar: string;
}

export interface PasscodeExpectation {
  title: string;
  fields: Readonly<Record<string, string>>;
  attributeCount: number;
}

export interface FolderNoteExpectation {
  title: string;
  /** The note once every member's line is in. */
  text: string;
  /** Roster names of the members who add lines, in order. */
  authors: readonly string[];
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
  /** Each group's name and its members' roster names (`firstName lastName`). */
  groups: ReadonlyArray<{ name: string; members: readonly string[] }>;
  passcodes: PasscodeExpectation[];
  folders: ReadonlyArray<{
    name: string;
    grants: ReadonlyArray<{ group: string; access: string }>;
    notes: FolderNoteExpectation[];
  }>;
};

// These positional IDs are the website gallery's explicit fixture contract.
const galleryTitles = {
  photos: ["Sunday dinner at Mom's.jpg", "Waterfront walk with Pepper.jpg"],
  tools: ["Drill Alderforge AF-D18", "Circular Saw Alderforge AF-CS165"],
  appliances: [
    "Washing Machine Hearthmere HM-W8",
    "Refrigerator Hearthmere HM-R320",
  ],
};
const galleryMatches = Object.entries(galleryTitles).every(([kind, titles]) => {
  const items = seedExpectations[kind as keyof typeof galleryTitles];
  return (
    items.length === titles.length &&
    items.every((item, index) => item.title === titles[index])
  );
});

// The authorship and history captures need a folder note that members of a
// writing group add to, and the passcode capture one with extra attributes.
const sharedNote = seedExpectations.folders
  .find(({ grants }) => grants.some(({ access }) => access === "write"))
  ?.notes.find(({ authors }) => authors.length >= 2);

if (
  seedExpectations.schemaVersion !== 4 ||
  !seedExpectations.groups.some((group) => group.members.length > 0) ||
  !galleryMatches ||
  !sharedNote ||
  !seedExpectations.passcodes.some(
    ({ attributeCount }) => attributeCount > 0,
  ) ||
  ![...seedExpectations.tools, ...seedExpectations.appliances].every(
    ({ avatar }) => avatar,
  ) ||
  seedExpectations.weight.rowCount < 2 ||
  seedExpectations.bloodPressure.rowCount < 2
) {
  throw new Error(
    "Continuity does not provide the required screenshot coverage.",
  );
}
