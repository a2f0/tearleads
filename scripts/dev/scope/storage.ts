import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, posix } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { c, t, x } from "tar";
import { settings } from "./settings";

// Public Azurite development key, never a cloud credential.
const emulatorKey =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const connection = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${emulatorKey};BlobEndpoint=${settings.blobOrigin}/devstoreaccount1;`;
const service = BlobServiceClient.fromConnectionString(connection);
const container = service.getContainerClient("snapshots");

export function blobName(value: string): string {
  const url = new URL(value);
  const prefix = "/devstoreaccount1/snapshots/";
  if (
    url.origin !== settings.blobOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(prefix)
  ) {
    throw new Error(
      "Artifact must belong to the configured local snapshots container",
    );
  }
  const name = decodeURIComponent(url.pathname.slice(prefix.length));
  if (
    name.includes("\\") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Artifact contains an unsafe blob path");
  return name;
}

/** Reject paths and links that could escape the extracted evidence directory. */
export function safeArchiveEntry(path: string, type: string): boolean {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  return (
    !isAbsolute(normalized) &&
    !/^[A-Za-z]:/.test(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    ["File", "Directory", "OldFile", "ContiguousFile"].includes(type)
  );
}

export async function extractSnapshot(
  url: string,
  target: string,
): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "scope-snapshot-"));
  const file = join(temp, "snapshot.tar.gz");
  try {
    await container.getBlobClient(blobName(url)).downloadToFile(file);
    await extractArchiveFile(file, target);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** Validate the complete archive before extracting any evidence. */
export async function extractArchiveFile(
  file: string,
  target: string,
): Promise<void> {
  const rejected: string[] = [];
  await t({
    file,
    onReadEntry: (entry) => {
      if (!safeArchiveEntry(entry.path, entry.type)) rejected.push(entry.path);
    },
  });
  if (rejected.length)
    throw new Error(
      `Unsafe snapshot entries: ${rejected.slice(0, 5).join(", ")}`,
    );
  await x({
    file,
    cwd: target,
    strict: true,
    preservePaths: false,
    noChmod: true,
  });
}

export async function readToolCalls(url: string): Promise<unknown[]> {
  const blob = container.getBlobClient(blobName(url));
  if (!(await blob.exists())) return [];
  const body = (await blob.downloadToBuffer()).toString("utf8");
  return body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
}

/** Native ACP runs have no HAR; their saved display events still contain tool errors. */
export async function readWorkerLog(
  snapshotUrl: string,
): Promise<{ iteration: number; events: unknown[] } | undefined> {
  const match =
    /^([^/]+)\/runs\/([^/]+)\/iteration-(\d+)\/workspace\.tar\.gz$/.exec(
      blobName(snapshotUrl),
    );
  if (!match) return undefined;
  const blob = service
    .getContainerClient("logs")
    .getBlobClient(`${match[1]}/runs/${match[2]}/run.jsonl`);
  if (!(await blob.exists())) return undefined;
  const values: unknown[] = (await blob.downloadToBuffer())
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
  return { iteration: Number(match[3]), events: values };
}

/** Exclude prior turns and Judge feedback, including when replaying an evaluation. */
export function selectToolEvents(
  values: unknown[],
  iteration: number,
): unknown[] {
  return values.filter((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("message" in value) ||
      typeof value.message !== "string" ||
      !/^Tool (call|update):/.test(value.message) ||
      !("data" in value) ||
      !value.data ||
      typeof value.data !== "object"
    )
      return false;
    return "iteration" in value.data && value.data.iteration === iteration;
  });
}

export async function uploadFixture(
  directory: string,
  id: string,
): Promise<string> {
  await container.createIfNotExists();
  const temp = await mkdtemp(join(tmpdir(), "scope-fixture-"));
  try {
    const file = join(temp, "workspace.tar.gz");
    await c({ gzip: true, file, cwd: directory }, ["."]);
    const blob = container.getBlockBlobClient(
      `${id}/iteration-1/workspace.tar.gz`,
    );
    await blob.uploadFile(file);
    return blob.url;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
