import type { DataCollection } from "@sentry/core";

/** Deny Sentry 11's expanded collection defaults before event sanitization. */
export function privateDataCollection(): DataCollection {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
    stackFrameVariables: false,
    frameContextLines: 0,
  };
}
