import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { orderCriteria } from "./judge/criteria";
import { apiRequest, getSavedConfig, settings } from "./settings";
import { criterionSchema, type Suite, suiteSchema } from "./types";

export function projectConfig() {
  const savedConfig = getSavedConfig();
  if (!savedConfig || savedConfig.apiUrl !== settings.apiUrl)
    throw new Error("Run bun run scope:register first");
  return savedConfig;
}

export async function readSuite(
  name: "smoke" | "agent-friendliness",
): Promise<Suite> {
  const suite = suiteSchema.parse(
    JSON.parse(
      await readFile(
        join(import.meta.dir, "benchmarks", `${name}.json`),
        "utf8",
      ),
    ),
  );
  orderCriteria(suite.criteria);
  const known = new Set(suite.criteria.map((c) => c.id));
  if (new Set(suite.tasks.map((task) => task.id)).size !== suite.tasks.length)
    throw new Error("Duplicate task IDs");
  for (const task of suite.tasks) {
    if (
      new Set(task.criteria).size !== task.criteria.length ||
      task.criteria.some((id) => !known.has(id))
    ) {
      throw new Error(`Invalid task criteria: ${task.id}`);
    }
  }
  return suite;
}

export async function seedCriteria(suite: Suite): Promise<void> {
  const query = `?projectId=${encodeURIComponent(projectConfig().projectId)}`;
  const existing = z
    .array(criterionSchema)
    .parse(await apiRequest(`/criteria${query}`));
  for (const criterion of suite.criteria) {
    const found = existing.find((c) => c.id === criterion.id);
    if (found)
      assert.deepEqual(
        found,
        criterion,
        `Criterion ${criterion.id} changed; use a new versioned ID`,
      );
    else await apiRequest(`/criteria${query}`, criterion);
  }
}
