import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  MetadataRootBehindDirectoryError,
  withMetadataRootReload,
} from "./groupMetadataErrors";

function staleThen(results: readonly (Error | string)[]) {
  const queue = [...results];
  return async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}

test("a root behind the directory is evicted and read once more", async () => {
  let evictions = 0;
  await expect(
    withMetadataRootReload(
      staleThen([new MetadataRootBehindDirectoryError(), "fresh"]),
      () => {
        evictions += 1;
      },
    ),
  ).resolves.toBe("fresh");
  expect(evictions).toBe(1);
});

test("a root still behind after the reload is an incident", async () => {
  let evictions = 0;
  const stale = withMetadataRootReload(
    staleThen([
      new MetadataRootBehindDirectoryError(),
      new MetadataRootBehindDirectoryError(),
    ]),
    () => {
      evictions += 1;
    },
  );
  await expect(stale).rejects.toBeInstanceOf(KeyingVerificationError);
  await expect(stale).rejects.toMatchObject({ code: "object_mismatch" });
  expect(evictions).toBe(1);
});

test("any other failure is not retried", async () => {
  let evictions = 0;
  await expect(
    withMetadataRootReload(staleThen([new Error("unavailable")]), () => {
      evictions += 1;
    }),
  ).rejects.toThrow("unavailable");
  expect(evictions).toBe(0);
});
