import { z } from "zod";
import { apiRequest } from "../settings";
import { type Criterion, criterionSchema } from "../types";

/** Order parents before children and reject cycles, missing parents and duplicates. */
export function orderCriteria(criteria: Criterion[]): Criterion[] {
  const index = new Map(criteria.map((c) => [c.id, c]));
  if (index.size !== criteria.length)
    throw new Error("Duplicate criterion IDs");
  const visiting = new Set<string>();
  const done = new Set<string>();
  const result: Criterion[] = [];
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("Cycle in criterion dependencies");
    if (done.has(id)) return;
    const criterion = index.get(id);
    if (!criterion) throw new Error(`Missing prerequisite: ${id}`);
    visiting.add(id);
    for (const parent of criterion.dependsOn) visit(parent);
    visiting.delete(id);
    done.add(id);
    result.push(criterion);
  }
  for (const id of index.keys()) visit(id);
  return result;
}

export async function loadCriteria(
  ids: string[],
  projectId: string,
): Promise<Criterion[]> {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error("Empty or duplicate criteria");
  const all = z
    .array(criterionSchema)
    .parse(
      await apiRequest(`/criteria?projectId=${encodeURIComponent(projectId)}`),
    );
  const index = new Map(all.map((c) => [c.id, c]));
  const selected = new Map<string, Criterion>();
  const queue = [...ids];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (selected.has(id)) continue;
    const criterion = index.get(id);
    if (!criterion) throw new Error(`Unknown criterion: ${id}`);
    selected.set(id, criterion);
    queue.push(...criterion.dependsOn);
  }
  return orderCriteria([...selected.values()]);
}
