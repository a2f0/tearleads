import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

test("native listeners stay on loopback for implicit, wildcard and explicit hosts", () => {
  const program = `
    const net = require('node:net');
    (async () => {
      for (const args of [[], [() => {}], [{}], [0], [0, '0.0.0.0'], [0, '::'], [0, '192.0.2.1'], [{port: 0, host: '0.0.0.0'}], [{port: 0}]]) {
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.on('error', reject); server.once('listening', resolve); server.listen(...args); });
        if (server.address().address !== '127.0.0.1') throw new Error('Non-loopback listener');
        await new Promise(resolve => server.close(resolve));
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  assert.equal(
    execFileSync(
      "node",
      ["--require", join(import.meta.dir, "../loopback.cjs"), "-e", program],
      { encoding: "utf8", timeout: 10000 },
    ),
    "",
  );
});
