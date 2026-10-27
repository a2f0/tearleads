import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("native HTTP guard rejects rebinding, cross-site HTTP and WebSocket upgrades before dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scope-browser-guard-"));
  try {
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, "../browser-guard.ts")],
      target: "node",
      format: "esm",
      outdir: directory,
      naming: "guard.mjs",
    });
    expect(built.success).toBe(true);
    await copyFile(
      join(import.meta.dir, "../pins.json"),
      join(directory, "pins.json"),
    );
    const program = `
      const http = require('node:http');
      const assert = require('node:assert/strict');
      let reached = 0;
      const server = http.createServer((req, res) => { reached++; res.end('ok'); });
      server.on('upgrade', (req, socket) => { reached++; socket.end(); });
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const host = '127.0.0.1:' + port;
        const request = headers => new Promise((resolve, reject) => {
          const req = http.request({hostname: '127.0.0.1', port, method: 'POST', headers}, res => {
            res.resume(); res.on('end', () => resolve(res.statusCode));
          });
          req.on('error', reject); req.end('{}');
        });
        try {
          assert.equal(await request({host}), 200);
          assert.equal(await request({host, origin: 'http://127.0.0.1:5100'}), 200);
          for (const headers of [
            {host: 'evil.invalid:' + port},
            {host, origin: 'https://evil.invalid', 'content-type': 'application/json'},
            {host, origin: 'https://evil.invalid', 'content-type': 'text/plain'},
            {host, origin: 'null'},
            {host, 'sec-fetch-site': 'cross-site'},
            {host, origin: 'https://evil.invalid', connection: 'Upgrade', upgrade: 'websocket'},
            {host: 'evil.invalid:' + port, connection: 'Upgrade', upgrade: 'websocket'},
          ]) assert.equal(await request(headers), 403);
          assert.equal(reached, 2);
        } catch (error) { console.error(error); process.exitCode = 1; }
        finally { server.close(); }
      });
    `;
    expect(
      execFileSync(
        "node",
        ["--import", join(directory, "guard.mjs"), "-e", program],
        {
          encoding: "utf8",
          timeout: 15_000,
        },
      ),
    ).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
