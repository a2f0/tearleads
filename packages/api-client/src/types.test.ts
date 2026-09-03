import { expect, test } from "bun:test";
import type { RequestFn } from "./index";

test("RequestFn retains its legacy three-argument call signature", async () => {
  const request: RequestFn = async () => null;

  await expect(
    request(
      "/health",
      (value): value is string => typeof value === "string",
      "GET",
    ),
  ).resolves.toBeNull();
});
