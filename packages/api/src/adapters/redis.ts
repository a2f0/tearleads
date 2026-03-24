import { createClient } from "redis";

const client = createClient();

client.on("error", (err) => {
  console.error("Redis client error:", err);
});

await client.connect();

export async function get(key: string): Promise<string | null> {
  return client.get(key);
}

export async function set(key: string, value: string): Promise<void> {
  await client.set(key, value);
}
