import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { PrincipalPolicyError } from "./shared";

interface ScheduledPreparation {
  readonly run: () => Promise<void>;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const unavailable = () =>
  new PrincipalPolicyError(
    "Principal history preparation is busy; retry later",
    503,
  );

/** One active page per principal; waiting principals take turns between pages. */
export function createPrincipalHistoryScheduler(input: {
  readonly concurrency: number;
  readonly maximumQueued: number;
  readonly maximumQueuedPerPrincipal: number;
  readonly queueTimeoutMs: number;
}) {
  const active = new Set<string>();
  const waiting = new Map<string, ScheduledPreparation[]>();
  let queued = 0;

  function drain(): void {
    for (const [principal, tasks] of waiting) {
      if (active.size >= input.concurrency) return;
      if (active.has(principal)) continue;
      const task = tasks.shift();
      if (!task) continue;
      queued -= 1;
      clearTimeout(task.timer);
      waiting.delete(principal);
      // A principal with more work rejoins the back of the waiting order.
      if (tasks.length) waiting.set(principal, tasks);
      active.add(principal);
      void task.run().finally(() => {
        active.delete(principal);
        drain();
      });
    }
  }

  return <T>(principal: string, work: () => Promise<T>): Promise<T> => {
    const tasks = waiting.get(principal) ?? [];
    if (
      queued >= input.maximumQueued ||
      tasks.length >= input.maximumQueuedPerPrincipal
    )
      return Promise.reject(unavailable());
    return new Promise<T>((resolve, reject) => {
      const task: ScheduledPreparation = {
        reject,
        timer: undefined,
        async run() {
          try {
            resolve(await work());
          } catch (error) {
            reject(error);
          }
        },
      };
      tasks.push(task);
      waiting.set(principal, tasks);
      queued += 1;
      task.timer = setTimeout(() => {
        const current = waiting.get(principal);
        const index = current?.indexOf(task) ?? -1;
        if (!current || index < 0) return;
        current.splice(index, 1);
        queued -= 1;
        if (current.length === 0) waiting.delete(principal);
        task.reject(unavailable());
      }, input.queueTimeoutMs);
      drain();
    });
  };
}

const schedulers = new WeakMap<
  ApiDatabase,
  ReturnType<typeof createPrincipalHistoryScheduler>
>();

/** Called only after rollback; queued work owns no application transaction. */
export function schedulePrincipalHistoryPreparation<T>(
  db: ApiDatabase,
  head: ReferencedPrincipalHead,
  work: () => Promise<T>,
): Promise<T> {
  let schedule = schedulers.get(db);
  if (!schedule) {
    schedule = createPrincipalHistoryScheduler({
      concurrency: 2,
      maximumQueued: 64,
      maximumQueuedPerPrincipal: 2,
      queueTimeoutMs: 2_000,
    });
    schedulers.set(db, schedule);
  }
  return schedule(JSON.stringify([head.principalType, head.principalId]), work);
}
