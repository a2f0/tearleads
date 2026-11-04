import { openApiBytes } from "../apiReference/sources";

/** docs/openapi.json, byte for byte, for download beside the reference. */
export function GET(): Response {
  return new Response(openApiBytes, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
