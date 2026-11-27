import { createConnection, createServer, type Socket } from "node:net";
import { userInfo } from "node:os";
import {
  countConnection,
  emptyTraffic,
  type PostgresTraffic,
} from "./postgresWire";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The measured database must be a local, disposable one: the probe registers
 * accounts and writes thousands of folders into it.
 */
export function parseLocalDatabaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("Set DATABASE_URL to a local scratch database.");
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    throw new Error("DATABASE_URL must be a postgres:// URL.");
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new Error("DATABASE_URL must name a loopback host.");
  if (url.pathname.length <= 1)
    throw new Error("DATABASE_URL must name a database.");
  const ssl = url.searchParams.get("sslmode");
  if (ssl && ssl !== "disable")
    throw new Error("The probe counts unencrypted local traffic only.");
  // pg falls back to the OS user in Bun; read-routing checks need it named.
  if (!url.username) url.username = userInfo().username;
  return url;
}

function pipeCounted(
  client: Socket,
  upstream: Socket,
  counter: ReturnType<typeof countConnection>,
): void {
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("data", (chunk: Buffer) => {
    try {
      counter.sent(chunk);
    } catch {
      closeBoth();
      return;
    }
    if (!upstream.write(chunk)) client.pause();
  });
  upstream.on("data", (chunk: Buffer) => {
    try {
      counter.returned(chunk);
    } catch {
      closeBoth();
      return;
    }
    if (!client.write(chunk)) upstream.pause();
  });
  upstream.on("drain", () => client.resume());
  client.on("drain", () => upstream.resume());
  client.on("close", closeBoth);
  upstream.on("close", closeBoth);
  client.on("error", closeBoth);
  upstream.on("error", closeBoth);
}

/**
 * A loopback TCP proxy in front of `target` that counts what the API sends
 * and what PostgreSQL returns. The API connects to `url` instead.
 */
export async function startPostgresProxy(target: URL) {
  const traffic = emptyTraffic();
  const upstreamHost = target.hostname === "[::1]" ? "::1" : target.hostname;
  const upstreamPort = Number(target.port || "5432");
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = createConnection({
      host: upstreamHost,
      port: upstreamPort,
    });
    sockets.add(client);
    sockets.add(upstream);
    client.on("close", () => sockets.delete(client));
    upstream.on("close", () => sockets.delete(upstream));
    pipeCounted(client, upstream, countConnection(traffic));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The PostgreSQL proxy has no port.");
  const url = new URL(target);
  url.hostname = "127.0.0.1";
  url.port = String(address.port);
  return {
    url: url.toString(),
    snapshot: (): PostgresTraffic => ({ ...traffic }),
    async stop(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
