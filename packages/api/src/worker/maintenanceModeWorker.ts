/**
 * The Worker a greenfield reset publishes under the API Worker's own name
 * (`wrangler.maintenance.jsonc`, through `scripts/deployApiMaintenance.sh`).
 * It holds no bindings and no Durable Object classes, so every request is
 * refused here and the API hostname stays attached while the tier's data is
 * replaced. Browsers get CORS answers, so clients read the 503 instead of
 * reporting a network failure.
 */

/** Marks the reset refusal apart from the API's own 503 answers. */
export const MAINTENANCE_HEADER = "x-tearleads-maintenance";
export const MAINTENANCE_RETRY_AFTER_SECONDS = 120;

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": `retry-after, ${MAINTENANCE_HEADER}`,
    "cache-control": "no-store",
    [MAINTENANCE_HEADER]: "reset",
  });
  const requestedHeaders = request.headers.get(
    "access-control-request-headers",
  );
  if (requestedHeaders !== null) {
    headers.set("access-control-allow-headers", requestedHeaders);
  }
  return headers;
}

function maintenanceResponse(request: Request): Response {
  const headers = corsHeaders(request);
  if (
    request.method === "OPTIONS" &&
    request.headers.has("access-control-request-method")
  ) {
    headers.set(
      "access-control-allow-methods",
      "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    return new Response(null, { status: 204, headers });
  }
  headers.set("retry-after", String(MAINTENANCE_RETRY_AFTER_SECONDS));
  return Response.json(
    { error: "The API is under maintenance; retry later" },
    { status: 503, headers },
  );
}

export default {
  fetch(request: Request): Response {
    return maintenanceResponse(request);
  },
};
