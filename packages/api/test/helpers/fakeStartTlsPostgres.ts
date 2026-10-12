import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import tls from "node:tls";

/**
 * A Postgres impostor for TLS tests: it answers the SSLRequest with "S",
 * upgrades the connection with a self-signed certificate, and refuses any
 * startup message with a FATAL error. A client that verifies certificates
 * must abandon the handshake before sending that message; the `events` log
 * shows what each connection did.
 */
export interface FakeStartTlsPostgres {
  readonly port: number;
  readonly events: () => readonly string[];
  readonly stop: () => Promise<void>;
}

async function selfSignedCertificate(hostname: string): Promise<{
  readonly key: string;
  readonly cert: string;
  readonly dir: string;
}> {
  const dir = await mkdtemp(resolve(tmpdir(), "tearleads-fake-postgres-"));
  const keyPath = resolve(dir, "key.pem");
  const certPath = resolve(dir, "cert.pem");
  const generate = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "2",
      "-subj",
      `/CN=${hostname}`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    generate.exited,
    new Response(generate.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`openssl could not create a certificate:\n${stderr}`);
  }
  return {
    key: await Bun.file(keyPath).text(),
    cert: await Bun.file(certPath).text(),
    dir,
  };
}

function isSslRequest(chunk: Buffer): boolean {
  return (
    chunk.length === 8 &&
    chunk.readUInt32BE(0) === 8 &&
    chunk.readUInt32BE(4) === 80877103
  );
}

function fatalErrorResponse(message: string): Buffer {
  const body = Buffer.concat([
    Buffer.from("SFATAL\0"),
    Buffer.from("C28000\0"),
    Buffer.from(`M${message}\0`),
    Buffer.from([0]),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length + 4, 0);
  return Buffer.concat([Buffer.from("E"), length, body]);
}

export async function startFakeStartTlsPostgres(
  hostname = "fake-postgres.test",
): Promise<FakeStartTlsPostgres> {
  const certificate = await selfSignedCertificate(hostname);
  const events: string[] = [];
  const server = net.createServer((socket) => {
    socket.once("data", (received) => {
      const chunk = Buffer.isBuffer(received)
        ? received
        : Buffer.from(received);
      if (!isSslRequest(chunk)) {
        events.push("plaintext startup");
        socket.end(fatalErrorResponse("TLS required"));
        return;
      }
      events.push("ssl request");
      socket.write("S");
      const secure = new tls.TLSSocket(socket, {
        isServer: true,
        key: certificate.key,
        cert: certificate.cert,
      });
      secure.on("secure", () => events.push("tls established"));
      secure.on("data", () => {
        events.push("startup over tls");
        secure.end(fatalErrorResponse("fake server"));
      });
      secure.on("error", (error) => events.push(`tls error: ${error.message}`));
    });
    socket.on("error", (error) =>
      events.push(`socket error: ${error.message}`),
    );
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The fake server has no TCP port"));
        return;
      }
      resolvePort(address.port);
    });
  });
  return {
    port,
    events: () => events,
    stop: async () => {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      await rm(certificate.dir, { recursive: true, force: true });
    },
  };
}
