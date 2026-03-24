import { createClient } from "redis";

const client = createClient();

client.on("error", (err) => {
  console.error("Redis client error:", err);
});

await client.connect();

export async function get(key: string): Promise<string | null> {
  return client.get(key);
}

export async function set(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  if (ttlSeconds !== undefined) {
    await client.set(key, value, { EX: ttlSeconds });
  } else {
    await client.set(key, value);
  }
}

export async function del(key: string): Promise<void> {
  await client.del(key);
}
