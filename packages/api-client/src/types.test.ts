import { expect, test } from "bun:test";
import { getHealthOperation } from "@tearleads/validators/operation";
import type { OperationRequestFn } from "./types";

test("operation requests require their failure contract", async () => {
  const acceptsThreeArguments: 3 extends Parameters<OperationRequestFn>["length"]
    ? true
    : false = false;
  expect(acceptsThreeArguments).toBe(false);
  const request: OperationRequestFn = async () => null;

  await expect(
    request(
      "/health",
      (value): value is string => typeof value === "string",
      "GET",
      undefined,
      undefined,
      getHealthOperation,
    ),
  ).resolves.toBeNull();
});
