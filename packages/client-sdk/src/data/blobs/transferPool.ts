/** Bound byte I/O across documents sharing a client, including multipart parts. */
const TRANSFER_CONCURRENCY = 4;
const TRANSFER_IDLE_TIMEOUT_MS = 120_000;
interface TransferPool {
  active: number;
  waiting: Array<() => void>;
}
const pools = new WeakMap<object, TransferPool>();

export async function runBlobTransfer<T>(
  client: object,
  transfer: (signal: AbortSignal, progress: () => void) => Promise<T>,
  timeoutMs = TRANSFER_IDLE_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("Blob transfer timeout must be positive and finite");
  let pool = pools.get(client);
  if (!pool) {
    pool = { active: 0, waiting: [] };
    pools.set(client, pool);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const progress = () => {
    controller.signal.throwIfAborted();
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error("Blob transfer timed out")),
      timeoutMs,
    );
  };
  let acquired = false;
  progress();
  try {
    await acquire(pool, controller.signal);
    acquired = true;
    progress();
    // A native bridge or custom transport may ignore abort. Bound its logical
    // ownership anyway; callers must check the signal before accepting results.
    return await new Promise<T>((resolve, reject) => {
      const aborted = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", aborted, { once: true });
      void Promise.resolve()
        .then(() => transfer(controller.signal, progress))
        .then(
          (value) => {
            controller.signal.removeEventListener("abort", aborted);
            resolve(value);
          },
          (error: unknown) => {
            controller.signal.removeEventListener("abort", aborted);
            reject(error);
          },
        );
    });
  } finally {
    clearTimeout(timer);
    if (acquired) {
      const next = pool.waiting.shift();
      if (next) next();
      else pool.active -= 1;
    }
  }
}

async function acquire(pool: TransferPool, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (pool.active < TRANSFER_CONCURRENCY) {
    pool.active += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", aborted);
      resolve();
    };
    const aborted = () => {
      const index = pool.waiting.indexOf(start);
      if (index >= 0) pool.waiting.splice(index, 1);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    pool.waiting.push(start);
  });
}
