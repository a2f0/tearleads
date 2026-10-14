import { expect, test } from "bun:test";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
  writeStoredDocumentFields,
} from "@tearleads/client-sdk";
import { createDocument } from "@tearleads/loro";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../projectors";
import { readBirthCertificateFieldsFromRecord } from "./birthCertificateDocumentDefinition";

test("birth certificate fields survive a Loro snapshot and project a human title", async () => {
  const document = await createDocument("birth-certificate-fields");
  const fields = {
    certificateNumber: "UT-B-1991-0314-042",
    fullName: "Maya Elena Reyes",
    dateOfBirth: "1991-03-14",
    placeOfBirth: "Aurelia, Utopia",
    parentNames: "Rosa María Reyes",
    issuingAuthority: "Aurelia Civil Registry, Utopia",
    dateIssued: "1991-03-20",
  };
  initializeStoredDocumentKind(
    document,
    "birth_certificate",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  writeStoredDocumentFields(
    document,
    "birth_certificate",
    fields,
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  const restored = await createDocument("birth-certificate-restored");
  restored.import(document.export({ mode: "snapshot" }));
  expect(
    readStoredDocumentState(restored, APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  ).toMatchObject({
    documentKind: "birth_certificate",
    title: "Birth Certificate Maya Elena Reyes",
    structuredFields: fields,
  });
});

test("empty and number-only birth certificates have useful titles", async () => {
  const document = await createDocument("birth-certificate-title");
  initializeStoredDocumentKind(
    document,
    "birth_certificate",
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  expect(
    readStoredDocumentState(document, APP_DOCUMENT_PROJECTOR_DEFINITIONS).title,
  ).toBe("Untitled birth certificate");
  writeStoredDocumentFields(
    document,
    "birth_certificate",
    { certificateNumber: "  BC-42  " },
    APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  );
  expect(
    readStoredDocumentState(document, APP_DOCUMENT_PROJECTOR_DEFINITIONS).title,
  ).toBe("Birth Certificate BC-42");
});

test("birth and issue dates must be real calendar dates while empty fields are allowed", () => {
  expect(readBirthCertificateFieldsFromRecord({}).issues).toEqual([]);
  expect(
    readBirthCertificateFieldsFromRecord({
      dateOfBirth: "2024-02-29",
      dateIssued: "2024-03-01",
    }).issues,
  ).toEqual([]);
  expect(
    readBirthCertificateFieldsFromRecord({
      dateOfBirth: "2023-02-29",
      dateIssued: "2024-13-01",
      fullName: 42,
    }).issues.map((issue) => issue.field),
  ).toEqual(["fullName", "dateOfBirth", "dateIssued"]);
});
