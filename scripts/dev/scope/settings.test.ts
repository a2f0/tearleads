import { test } from "bun:test";
import assert from "node:assert/strict";
import { loopbackOrigin } from "./settings";
import { readSuite } from "./suites";

test("API origins allow only uncredentialed loopback HTTP endpoints", () => {
  for (const origin of [
    "http://127.0.0.1:3101",
    "http://localhost:3101",
    "https://[::1]:3101",
  ])
    assert.equal(loopbackOrigin(`${origin}/`), origin);
  for (const origin of [
    "https://example.com",
    "http://127.0.0.1@evil.invalid",
    "http://token@localhost",
    "file:///tmp/socket",
    "http://localhost/api",
    "http://localhost/?token=x",
    "http://localhost/#x",
  ])
    assert.throws(() => loopbackOrigin(origin));
});

test("tracked benchmark suites have valid criteria, dependencies and task references", async () => {
  for (const name of ["smoke", "agent-friendliness"] as const) {
    const suite = await readSuite(name);
    assert.ok(suite.tasks.length > 0);
  }
});
