import { expect, test } from "bun:test";
import {
  projectStoredDocumentState,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
import { trackerGraphTimestamp } from "../shared/timeSeriesGraphData";
import { loadContinuityAssets } from "./continuityAssets";
import { continuityGroups } from "./continuityRoster";
import { continuityDocuments, type SeedDocument } from "./seedDocuments";

interface Detail {
  readonly title: string;
  readonly imageCount?: number;
}

function project(document: SeedDocument) {
  return projectStoredDocumentState(
    {
      documentKind: document.kind,
      structuredFields: document.fields ?? {},
      text: document.text ?? "",
      rows: document.rows?.map((fields, index) => ({
        id: String(index),
        fields,
      })),
    },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
}

// The CLI's seed tests write these documents to an API and read every one back
// from a fresh device. This pins the other half of the Continuity contract:
// each document the screenshot run asserts on exists exactly once, under the
// title and image count `expectations.json` promises, with valid fields.
test("pinned Continuity yields every promised document, title, image, and tracker row", async () => {
  const { spec, readAttachment } = await loadContinuityAssets();
  const expected = JSON.parse(
    new TextDecoder().decode(await readAttachment("expectations.json")),
  );
  const documents = continuityDocuments(spec);
  for (const document of documents) {
    expect(project(document).fieldValidationIssues).toEqual([]);
  }

  const contacts = documents.filter(({ kind }) => kind === "contact");
  expect(contacts.map((contact) => project(contact).title)).toContain(
    expected.contact.displayName,
  );
  const notes = documents.filter(({ kind }) => kind === "note");
  expect(notes.map((note) => project(note).title)).toContain(
    expected.note.title,
  );

  const promised: [StoredDocumentKind, readonly Detail[]][] = [
    ["drivers_license", [expected.driversLicense]],
    ["passport", [expected.passport]],
    ["birth_certificate", [expected.birthCertificate]],
    ["credit_card", [expected.creditCard]],
    ["image", expected.photos],
    ["tool", expected.tools],
    ["appliance", expected.appliances],
    ["weight", [expected.weight]],
    ["blood_pressure", [expected.bloodPressure]],
  ];
  for (const [kind, details] of promised) {
    const ofKind = documents.filter((document) => document.kind === kind);
    expect(ofKind).toHaveLength(details.length);
    for (const detail of details) {
      const matches = ofKind.filter(
        (document) => project(document).title === detail.title,
      );
      expect(matches).toHaveLength(1);
      const [document] = matches;
      if (!document) throw new Error(`Missing fixture for ${detail.title}`);
      expect(document.attachments).toHaveLength(detail.imageCount ?? 0);
      for (const { measuredAt = "" } of document.rows ?? []) {
        expect(Number.isFinite(trackerGraphTimestamp(measuredAt))).toBe(true);
      }
      for (const attachment of document.attachments) {
        expect((await readAttachment(attachment.file)).length).toBeGreaterThan(
          0,
        );
        if (
          (kind === "tool" || kind === "appliance") &&
          attachment.slot !== "receipt-image"
        )
          expect(attachment.multiple).toBe(true);
      }
    }
  }
});

test("single-image slots refuse unknown aliases and duplicates", async () => {
  const { spec } = await loadContinuityAssets();
  const withSlots = (slots: readonly string[]) => ({
    ...spec,
    files: [
      {
        kind: "drivers_license" as const,
        fields: { licenseId: "TEST" },
        attachments: slots.map((slot) => ({
          file: "front.png",
          mimeType: "image/png",
          slot,
        })),
      },
    ],
  });
  // The accepted aliases resolve, so each refusal below is the slot guard's.
  expect(continuityDocuments(withSlots(["front", "back"]))).toBeDefined();
  for (const slots of [
    ["f"],
    ["front", "front"],
    ["front", "driver-license-front-image"],
  ]) {
    expect(() => continuityDocuments(withSlots(slots))).toThrow(
      "Unknown or duplicate drivers_license attachment slot",
    );
  }
});

test("pinned Continuity groups resolve to the roster names the screenshot run asserts", async () => {
  const { spec, readAttachment } = await loadContinuityAssets();
  const expected = JSON.parse(
    new TextDecoder().decode(await readAttachment("expectations.json")),
  );
  expect(
    continuityGroups(spec).map(({ name, members }) => ({
      name,
      members: members.map(
        ({ firstName, lastName }) => `${firstName} ${lastName}`,
      ),
    })),
  ).toEqual(expected.groups);
});
