import { expect, test } from "bun:test";
import {
  BINARY_FILE_IMPORT_MAX_BYTES,
  getDocumentFileImporter,
  TEXT_FILE_IMPORT_MAX_BYTES,
} from "./importers";

const TEXT_ENCODER = new TextEncoder();

function createFile(
  name: string,
  content: BlobPart,
  options: FilePropertyBag = {},
): File {
  return new File([content], name, {
    lastModified: Date.UTC(2026, 4, 29, 12, 0, 0),
    ...options,
  });
}

function readVariablesJson(
  structuredFields: Readonly<{ variablesJson?: string }>,
): string {
  return structuredFields.variablesJson ?? "";
}

test("file importers classify by MIME type before extension", () => {
  expect(
    getDocumentFileImporter(
      createFile("looks-like-a.pdf", "audio", { type: "audio/mpeg" }),
    ).documentKind,
  ).toBe("audio");
  expect(
    getDocumentFileImporter(
      createFile("looks-like-a.mp3", "pdf", { type: "application/pdf" }),
    ).documentKind,
  ).toBe("pdf");
  expect(
    getDocumentFileImporter(
      createFile("contacts.bin", "name,email", { type: "text/csv" }),
    ).documentKind,
  ).toBe("note");
});

test("file importers classify by extension when MIME type is unavailable", () => {
  expect(
    getDocumentFileImporter(createFile("dl_front.jpeg", "x")).documentKind,
  ).toBe("image");
  expect(
    getDocumentFileImporter(createFile("logo.svg", "x")).documentKind,
  ).toBe("image");
  expect(
    getDocumentFileImporter(createFile("Skiff_Whitepaper_2023.pdf", "x"))
      .documentKind,
  ).toBe("pdf");
  expect(
    getDocumentFileImporter(createFile("voice.mp3", "x")).documentKind,
  ).toBe("audio");
  expect(
    getDocumentFileImporter(createFile("contacts.csv", "x")).documentKind,
  ).toBe("note");
  expect(
    getDocumentFileImporter(createFile(".env.local", "x")).documentKind,
  ).toBe("env_file");
  expect(
    getDocumentFileImporter(createFile("app.env.local", "x")).documentKind,
  ).toBe("env_file");
  expect(
    getDocumentFileImporter(createFile("archive.bin", "x")).documentKind,
  ).toBe("generic_file");
});

test("text files import as note text without attachments", async () => {
  const file = createFile("contacts.csv", "name,email\nAda,ada@example.test", {
    type: "text/csv",
  });
  const importer = getDocumentFileImporter(file);

  const result = await importer.importFile(file);

  expect(importer.maxByteLength).toBe(TEXT_FILE_IMPORT_MAX_BYTES);
  expect(result).toEqual({
    attachment: null,
    documentKind: "note",
    initialText: "name,email\nAda,ada@example.test",
    structuredFields: {},
  });
});

test("env files import as key value documents before text MIME handling", async () => {
  const file = createFile(
    ".env.local",
    [
      "API_URL=https://api.example.test",
      "export DEBUG=true",
      "# ignored",
      'QUOTED="hello world"',
    ].join("\n"),
    { type: "text/plain" },
  );
  const importer = getDocumentFileImporter(file);

  const result = await importer.importFile(file);

  expect(importer.maxByteLength).toBe(TEXT_FILE_IMPORT_MAX_BYTES);
  expect(result).toMatchObject({
    attachment: null,
    documentKind: "env_file",
    initialText: "",
    structuredFields: {
      fileName: ".env.local",
    },
  });
  expect(JSON.parse(readVariablesJson(result.structuredFields))).toEqual([
    {
      id: "env-1-api_url",
      key: "API_URL",
      value: "https://api.example.test",
    },
    {
      id: "env-2-debug",
      key: "DEBUG",
      value: "true",
    },
    {
      id: "env-4-quoted",
      key: "QUOTED",
      value: "hello world",
    },
  ]);
});

test("binary file importers attach original bytes and stable metadata", async () => {
  const bytes = TEXT_ENCODER.encode("jpeg-bytes");
  const file = createFile("dl_front.jpeg", bytes, { type: "image/jpeg" });
  const importer = getDocumentFileImporter(file);

  const result = await importer.importFile(file);

  expect(importer.maxByteLength).toBe(BINARY_FILE_IMPORT_MAX_BYTES);
  expect(result.documentKind).toBe("image");
  expect(result.initialText).toBe("");
  expect(result.structuredFields).toMatchObject({
    byteLength: String(bytes.byteLength),
    fileName: "dl_front.jpeg",
    mimeType: "image/jpeg",
    sourceLastModified: "2026-05-29T12:00:00.000Z",
  });
  expect(result.attachment?.name).toBe("dl_front.jpeg");
  expect(result.attachment?.mimeType).toBe("image/jpeg");
  expect(Array.from(result.attachment?.bytes ?? [])).toEqual(Array.from(bytes));
});

test("binary file importers prefer extension metadata for generic octet-stream drops", async () => {
  const file = createFile("Skiff_Whitepaper_2023.pdf", "pdf", {
    type: "application/octet-stream",
  });

  const result = await getDocumentFileImporter(file).importFile(file);

  expect(result.documentKind).toBe("pdf");
  expect(result.structuredFields).toMatchObject({
    mimeType: "application/pdf",
  });
  expect(result.attachment?.mimeType).toBe("application/pdf");
});

test("binary file importers tolerate invalid source modified timestamps", async () => {
  const file = createFile("corrupted.jpeg", "jpeg", { type: "image/jpeg" });
  Object.defineProperty(file, "lastModified", {
    value: Number.MAX_SAFE_INTEGER,
  });

  const result = await getDocumentFileImporter(file).importFile(file);

  expect(result.structuredFields).toMatchObject({
    sourceLastModified: "",
  });
});

test("svg image importer records dimensions when they are available in the source", async () => {
  const file = createFile(
    "logo.svg",
    '<!-- <svg width="10" height="20"> --><svg viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50" /></svg>',
    { type: "image/svg+xml" },
  );

  const result = await getDocumentFileImporter(file).importFile(file);

  expect(result.documentKind).toBe("image");
  expect(result.structuredFields).toMatchObject({
    height: "480",
    width: "640",
  });
});
