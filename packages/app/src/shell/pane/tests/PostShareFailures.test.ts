import { expect, test } from "bun:test";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import {
  listUnresolvedPostShareFailures,
  mayResolvePostShareFailure,
} from "../../../../test/helpers/dual-pane/postShareFailures";
import type { ProxiedApiRequest } from "../../../../test/helpers/proxiedApiResponse";

const RECOVERED = "Bearer recovered";
const ORIGINAL = "Bearer original";
const SELF_CONTACT = "self-contact-document";

function request(
  input: Partial<ProxiedApiRequest> & Pick<ProxiedApiRequest, "url">,
): ProxiedApiRequest {
  return {
    authorization: RECOVERED,
    method: "POST",
    requestBody: null,
    requestBodyBytes: 0,
    responseBody: "{}",
    responseBodyBytes: 2,
    status: 200,
    ...input,
    url: `http://localhost:3001${input.url}`,
  };
}

function createConflict(
  documentId = SELF_CONTACT,
  code: string = DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
): ProxiedApiRequest {
  return request({
    requestBody: JSON.stringify({ event: { objectId: documentId } }),
    responseBody: JSON.stringify({ code, error: "conflict" }),
    status: 409,
    url: "/documents",
  });
}

function documentSync(
  documentId = SELF_CONTACT,
  input: Partial<ProxiedApiRequest> = {},
): ProxiedApiRequest {
  return request({ ...input, url: `/documents/${documentId}/sync` });
}

test("an adopted stable-id create conflict is resolved", () => {
  const conflict = createConflict();
  expect(listUnresolvedPostShareFailures([conflict, documentSync()])).toEqual(
    [],
  );
  expect(
    listUnresolvedPostShareFailures([
      conflict,
      request({
        method: "GET",
        url: `/documents/${SELF_CONTACT}/writer-projection`,
      }),
    ]),
  ).toEqual([]);
  expect(mayResolvePostShareFailure(conflict)).toBe(true);
});

test("a create conflict without same-session adoption stays a failure", () => {
  const conflict = createConflict();
  for (const later of [
    [],
    [documentSync(SELF_CONTACT, { authorization: ORIGINAL })],
    [documentSync("another-document")],
  ]) {
    expect(listUnresolvedPostShareFailures([conflict, ...later])).toEqual([
      conflict,
    ]);
  }
  // A failed request for the document is no evidence of adoption.
  const failedSync = documentSync(SELF_CONTACT, { status: 409 });
  expect(listUnresolvedPostShareFailures([conflict, failedSync])).toEqual([
    conflict,
    failedSync,
  ]);
  // Adoption must follow the conflict, not precede it.
  expect(listUnresolvedPostShareFailures([documentSync(), conflict])).toEqual([
    conflict,
  ]);
});

test("a repeated create conflict for one document stays a failure", () => {
  const first = createConflict();
  const second = createConflict();
  expect(
    listUnresolvedPostShareFailures([
      first,
      documentSync(),
      second,
      documentSync(),
    ]),
  ).toEqual([first, second]);
});

test("other create conflicts are never treated as adoption", () => {
  const stale = createConflict(
    SELF_CONTACT,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
  );
  expect(listUnresolvedPostShareFailures([stale, documentSync()])).toEqual([
    stale,
  ]);
  expect(mayResolvePostShareFailure(stale)).toBe(false);
});

test("any other failure keeps an adopted conflict in the report", () => {
  const conflict = createConflict();
  const failure = request({
    method: "GET",
    status: 500,
    url: "/containers/container/writer-projection",
  });
  expect(
    listUnresolvedPostShareFailures([conflict, documentSync(), failure]),
  ).toEqual([conflict, failure]);
});

test("retryable sync conflicts still resolve on a later success", () => {
  const retryable = documentSync(SELF_CONTACT, {
    responseBody: JSON.stringify({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    }),
    status: 409,
  });
  expect(listUnresolvedPostShareFailures([retryable, documentSync()])).toEqual(
    [],
  );
  expect(listUnresolvedPostShareFailures([retryable])).toEqual([retryable]);
});
