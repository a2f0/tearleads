import { expect, test } from "bun:test";
import { descendantRekeysRequired } from "../../containers/mutations/errors";
import { toMutationError } from "./errors";

// The blob envelope keeps only `container_unavailable` and drops every other
// foreign code by design. A bind or detach whose inline rekey would strand a
// granted path is therefore refused as an uncoded 409, as the SDK guide says;
// the document's next sync pass makes the path current.

test("a refused inline rekey is an uncoded 409 through a blob write", () => {
  const mapped = toMutationError(descendantRekeysRequired(["a"]));
  expect(mapped?.status).toBe(409);
  expect(mapped?.code).toBeUndefined();
});
