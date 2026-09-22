import { expect, test } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { descendantRekeysRequired } from "../../containers/mutations/errors";
import { toMutationError } from "./errors";

// An inline container rekey refused for stranding a level above a directly
// granted container must stay answerable through a document write: the SDK
// keys its standalone-repair retry on this code.

test("a refused inline rekey keeps its code through a document write", () => {
  const mapped = toMutationError(descendantRekeysRequired(["a", "b"]));
  expect(mapped?.status).toBe(409);
  expect(mapped?.code).toBe(DOCUMENT_SYNC_ERROR_CODES.descendantRekeysRequired);
});
