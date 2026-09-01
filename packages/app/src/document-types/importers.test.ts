import { expect, test } from "bun:test";
import {
  createBlobByteSource,
  readBlobByteSource,
} from "@tearleads/client-sdk";
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

test("file importers classify by MIME type before extension", () => {
  expect(
    getDocumentFileImporter(
      createFile("looks-like-a.pdf", "audio", { type: "audio/mpeg" }),
    ).documentKind,
  ).toBe("audio");
  expect(
    getDocumentFileImporter(
      createFile("looks-like-a.mp3", "video", { type: "video/mp4" }),
    ).documentKind,
  ).toBe("video");
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
  expect(
    getDocumentFileImporter(
      createFile("config.bin", "{}", { type: "application/json" }),
    ).documentKind,
  ).toBe("json_file");
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
    getDocumentFileImporter(createFile("clip.webm", "x")).documentKind,
  ).toBe("video");
  expect(
    getDocumentFileImporter(createFile("contacts.csv", "x")).documentKind,
  ).toBe("note");
  expect(
    getDocumentFileImporter(createFile("config.json", "x")).documentKind,
  ).toBe("json_file");
  expect(
    getDocumentFileImporter(createFile(".env.local", "x")).documentKind,
  ).toBe("env_file");
  expect(
    getDocumentFileImporter(createFile("app.env.local", "x")).documentKind,
  ).toBe("env_file");
  expect(
    getDocumentFileImporter(createFile("my.env.file.txt", "x")).documentKind,
  ).toBe("note");
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

test("JSON files import as raw text with a filename title field", async () => {
  const jsonText = '{\n  "enabled": true\n}';
  const file = createFile("config.json", jsonText, {
    type: "application/json",
  });
  const importer = getDocumentFileImporter(file);

  const result = await importer.importFile(file);

  expect(importer.maxByteLength).toBe(TEXT_FILE_IMPORT_MAX_BYTES);
  expect(result).toEqual({
    attachment: null,
    documentKind: "json_file",
    initialText: jsonText,
    structuredFields: {
      fileName: "config.json",
    },
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
  expect(result).toEqual({
    attachment: null,
    documentKind: "env_file",
    initialText: "",
    rows: [
      { key: "API_URL", value: "https://api.example.test" },
      { key: "DEBUG", value: "true" },
      { key: "QUOTED", value: "hello world" },
    ],
    structuredFields: {
      fileName: ".env.local",
    },
  });
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
  const attachmentBytes = result.attachment
    ? await readBlobByteSource(createBlobByteSource(result.attachment.bytes))
    : null;
  expect(Array.from(attachmentBytes ?? [])).toEqual(Array.from(bytes));
});

test("video file importer attaches original bytes and stable metadata", async () => {
  const bytes = TEXT_ENCODER.encode("video-bytes");
  const file = createFile("demo.mp4", bytes, { type: "video/mp4" });
  const importer = getDocumentFileImporter(file);

  const result = await importer.importFile(file);

  expect(importer.maxByteLength).toBe(BINARY_FILE_IMPORT_MAX_BYTES);
  expect(result.documentKind).toBe("video");
  expect(result.initialText).toBe("");
  expect(result.structuredFields).toMatchObject({
    byteLength: String(bytes.byteLength),
    durationMs: "",
    fileName: "demo.mp4",
    height: "",
    mimeType: "video/mp4",
    sourceLastModified: "2026-05-29T12:00:00.000Z",
    width: "",
  });
  expect(result.attachment?.name).toBe("demo.mp4");
  expect(result.attachment?.mimeType).toBe("video/mp4");
  const attachmentBytes = result.attachment
    ? await readBlobByteSource(createBlobByteSource(result.attachment.bytes))
    : null;
  expect(Array.from(attachmentBytes ?? [])).toEqual(Array.from(bytes));
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

test("large image importers skip eager dimension reads", async () => {
  const svg = createFile("large.svg", "", { type: "image/svg+xml" });
  Object.defineProperty(svg, "size", {
    value: BINARY_FILE_IMPORT_MAX_BYTES,
  });
  Object.defineProperty(svg, "text", {
    value: async () => {
      throw new Error("Large SVG metadata must not read the whole file.");
    },
  });

  const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  let bitmapReads = 0;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => {
      bitmapReads += 1;
      throw new Error("Large raster metadata must not decode the whole file.");
    },
  });
  const png = createFile("large.png", "", { type: "image/png" });
  Object.defineProperty(png, "size", {
    value: BINARY_FILE_IMPORT_MAX_BYTES,
  });

  try {
    const [svgResult, pngResult] = await Promise.all([
      getDocumentFileImporter(svg).importFile(svg),
      getDocumentFileImporter(png).importFile(png),
    ]);
    expect(svgResult.structuredFields).not.toHaveProperty("height");
    expect(pngResult.structuredFields).not.toHaveProperty("height");
    expect(bitmapReads).toBe(0);
  } finally {
    if (originalCreateImageBitmap) {
      Object.defineProperty(
        globalThis,
        "createImageBitmap",
        originalCreateImageBitmap,
      );
    } else {
      Reflect.deleteProperty(globalThis, "createImageBitmap");
    }
  }
});
