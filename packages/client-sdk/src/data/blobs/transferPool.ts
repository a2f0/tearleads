/** Bound byte I/O across documents sharing a client, including multipart parts. */
const TRANSFER_CONCURRENCY = 4;
interface TransferPool {
  active: number;
  waiting: Array<() => void>;
}
const pools = new WeakMap<object, TransferPool>();

export async function runBlobTransfer<T>(
  client: object,
  transfer: () => Promise<T>,
): Promise<T> {
  let pool = pools.get(client);
  if (!pool) {
    pool = { active: 0, waiting: [] };
    pools.set(client, pool);
  }
  if (pool.active >= TRANSFER_CONCURRENCY) {
    await new Promise<void>((resolve) => pool.waiting.push(resolve));
  } else {
    pool.active += 1;
  }
  try {
    return await transfer();
  } finally {
    const next = pool.waiting.shift();
    if (next) next();
    else pool.active -= 1;
  }
}
