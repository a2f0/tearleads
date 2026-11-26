import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const reportDirectory = resolve(
  import.meta.dir,
  "../../../../.test_files/performance",
);

/** Writes `value` as owner-only JSON, replacing the file atomically. */
export async function saveJson(
  name: string,
  value: object,
  directory = reportDirectory,
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = resolve(directory, name);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

/** The account a run seeded, so a later run can measure it again. */
export interface SeededTree {
  readonly schemaVersion: 1;
  readonly database: string;
  readonly userId: string;
  readonly fanout: number;
  /** System folders first, then created folders in breadth-first order. */
  readonly containerIds: readonly string[];
  readonly seededAt: string;
  readonly seedMs: number;
}

export function seedFileName(database: string): string {
  return `realtime-seed-${database.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

function isSeededTree(value: unknown): value is SeededTree {
  if (typeof value !== "object" || value === null) return false;
  const ids: unknown = Reflect.get(value, "containerIds");
  return (
    Reflect.get(value, "schemaVersion") === 1 &&
    typeof Reflect.get(value, "database") === "string" &&
    typeof Reflect.get(value, "userId") === "string" &&
    typeof Reflect.get(value, "fanout") === "number" &&
    typeof Reflect.get(value, "seedMs") === "number" &&
    Array.isArray(ids) &&
    ids.every((id) => typeof id === "string")
  );
}

export async function loadSeededTree(
  database: string,
  directory = reportDirectory,
): Promise<SeededTree> {
  const path = resolve(directory, seedFileName(database));
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`No seeded tree for ${database}; run without --reuse.`);
  }
  const parsed: unknown = JSON.parse(text);
  if (!isSeededTree(parsed) || parsed.database !== database)
    throw new Error(`${path} is not a seeded tree for ${database}.`);
  return parsed;
}
