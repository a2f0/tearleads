function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Turbo returned malformed run evidence");
  return value as Record<string, unknown>;
}

function tasks(value: unknown): Record<string, unknown>[] {
  const rows = record(value).tasks;
  if (!Array.isArray(rows))
    throw new Error("Turbo run evidence has no task list");
  return rows.map(record);
}

export function plannedTurboTasks(value: unknown): Set<string> {
  const ids = new Set<string>();
  for (const row of tasks(value)) {
    if (typeof row.command !== "string" || typeof row.taskId !== "string")
      throw new Error("Turbo plan has an invalid task");
    if (row.command === "<NONEXISTENT>" || row.command.length === 0) continue;
    if (ids.has(row.taskId)) throw new Error("Turbo plan repeats a task");
    ids.add(row.taskId);
  }
  return ids;
}

export function assertCompletedTurboRun(input: {
  readonly summary: unknown;
  readonly planned: ReadonlySet<string>;
  readonly startedAt: number;
}) {
  const summary = record(input.summary);
  const execution = record(summary.execution);
  if (
    summary.version !== "1" ||
    execution.exitCode !== 0 ||
    execution.failed !== 0 ||
    execution.attempted !== input.planned.size ||
    typeof execution.success !== "number" ||
    !Number.isSafeInteger(execution.success) ||
    execution.success < 0 ||
    typeof execution.cached !== "number" ||
    !Number.isSafeInteger(execution.cached) ||
    execution.cached < 0 ||
    execution.success + execution.cached !== input.planned.size ||
    typeof execution.startTime !== "number" ||
    execution.startTime < input.startedAt ||
    typeof execution.endTime !== "number" ||
    execution.endTime < execution.startTime
  )
    throw new Error("Turbo did not complete every planned task successfully");
  const completed = new Set<string>();
  for (const row of tasks(summary)) {
    if (
      typeof row.taskId !== "string" ||
      !input.planned.has(row.taskId) ||
      completed.has(row.taskId) ||
      record(row.execution).exitCode !== 0
    )
      throw new Error(
        "Turbo task completion evidence is missing or unsuccessful",
      );
    completed.add(row.taskId);
  }
  if (completed.size !== input.planned.size)
    throw new Error("Turbo omitted planned tasks from its completion evidence");
}
