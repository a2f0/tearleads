function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Turbo returned malformed run evidence");
  return value as Record<string, unknown>;
}

function tasks(value: unknown): Record<string, unknown>[] {
  const { tasks: rows } = record(value);
  if (!Array.isArray(rows))
    throw new Error("Turbo run evidence has no task list");
  return rows.map(record);
}

export function plannedTurboTasks(value: unknown): Set<string> {
  const ids = new Set<string>();
  // Turbo 2.10 omits graph placeholders from executed task evidence.
  for (const { command, taskId } of tasks(value)) {
    if (typeof command !== "string" || typeof taskId !== "string")
      throw new Error("Turbo plan has an invalid task");
    if (command === "<NONEXISTENT>" || command.length === 0) continue;
    if (ids.has(taskId)) throw new Error("Turbo plan repeats a task");
    ids.add(taskId);
  }
  return ids;
}

export function assertCompletedTurboRun(input: {
  readonly summary: unknown;
  readonly planned: ReadonlySet<string>;
  readonly startedAt: number;
}) {
  const summary = record(input.summary);
  const { version, execution } = summary;
  const { exitCode, failed, attempted, success, cached, startTime, endTime } =
    record(execution);
  // Turbo 2.10 counts cache hits separately from successful executions.
  if (
    version !== "1" ||
    exitCode !== 0 ||
    failed !== 0 ||
    attempted !== input.planned.size ||
    typeof success !== "number" ||
    !Number.isSafeInteger(success) ||
    success < 0 ||
    typeof cached !== "number" ||
    !Number.isSafeInteger(cached) ||
    cached < 0 ||
    success + cached !== input.planned.size ||
    typeof startTime !== "number" ||
    startTime < input.startedAt ||
    typeof endTime !== "number" ||
    endTime < startTime
  )
    throw new Error("Turbo did not complete every planned task successfully");
  const completed = new Set<string>();
  for (const { taskId, execution: taskExecution } of tasks(summary)) {
    const { exitCode: taskExitCode } = record(taskExecution);
    if (
      typeof taskId !== "string" ||
      !input.planned.has(taskId) ||
      completed.has(taskId) ||
      taskExitCode !== 0
    )
      throw new Error(
        "Turbo task completion evidence is missing or unsuccessful",
      );
    completed.add(taskId);
  }
  if (completed.size !== input.planned.size)
    throw new Error("Turbo omitted planned tasks from its completion evidence");
}
