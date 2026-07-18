import { expect, test } from "bun:test";
import { describeErrorResponse } from "./requestInternals";

test("describeErrorResponse preserves protocol error codes exactly", async () => {
  const response = Response.json({
    code: " document_sync_state_stale ",
    error: "Stale state",
  });

  expect(await describeErrorResponse(response)).toMatchObject({
    code: " document_sync_state_stale ",
    error: "Stale state",
  });
});
