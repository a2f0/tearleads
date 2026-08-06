import { expect, test } from "bun:test";
import { ErrorResponseSchema, HealthResponseSchema } from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import { getHealthOperation } from "./health";
import { openApiDocument } from "./openApi";

test("health operation owns its HTTP contract", () => {
  expect(getHealthOperation).toMatchObject({
    auth: "none",
    failureStatuses: [413, 500],
    id: "health.get",
    method: "GET",
    path: "/",
    responses: { 200: HealthResponseSchema },
  });
  expect(getHealthOperation.failureResponses).toEqual({
    413: ErrorResponseSchema,
    500: ErrorResponseSchema,
  });
  expect(operationRoutePath(getHealthOperation)).toBe("/");
  expect(operationRequestPath(getHealthOperation, {})).toBe("/");
});

test("health OpenAPI documents its shared contract", () => {
  const operation = openApiDocument.paths["/"]?.get;
  if (operation === undefined) {
    throw new Error("Health OpenAPI operation is missing");
  }

  expect(operation.operationId).toBe("health.get");
  expect(operation.parameters).toEqual([]);
  expect(operation.security).toEqual([]);
  expect(Object.keys(operation.responses)).toEqual(["200", "413", "500"]);
});
