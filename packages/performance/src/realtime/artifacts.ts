import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reportDirectory } from "../reportFiles";

/** The account a run seeded, so a later run can measure it again. */
export interface SeededTree {
  readonly schemaVersion: 1;
  readonly database: string;
  readonly userId: string;
  readonly fanout: number;
  /** System folders first, then created folders in breadth-first order. */
  readonly containerIds: readonly string[];
  /** Root-lane container ids (direct grants / roots) declared in roots mode. */
  readonly rootContainerIds?: readonly string[] | undefined;
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
