import { expect, test } from "bun:test";
import { discoveryCursor } from "./discoveryCursor";

test("discovery cursors round-trip only in their issuing lane and replay a cursor from another database", () => {
  const scope = ["user", "documents", "container"] as const;
  const cursor = discoveryCursor("test-key", scope, null);
  const position = {
    id: "42/00000000-0000-4000-8000-000000000001",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const token = cursor.seal(position);
  expect(token).not.toBeNull();
  expect(token?.id).not.toContain("00000000-0000-4000-8000-000000000001");
  expect(cursor.seal(position)).not.toEqual(token);
  const resumed = discoveryCursor("test-key", scope, token);
  expect(resumed.position).toEqual(position);
  expect(resumed.publication).toBe("42");
  expect(resumed.seal(resumed.position)).toEqual(token);
  expect(discoveryCursor("other-key", scope, token).position).toBeNull();
  expect(
    discoveryCursor("test-key", ["other-user", "documents", "container"], token)
      .position,
  ).toBeNull();
  expect(
    discoveryCursor("test-key", ["user", "containers", "container"], token)
      .position,
  ).toBeNull();
});
