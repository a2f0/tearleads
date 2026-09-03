import {
  BinaryBodySchema,
  type HttpOperation,
} from "@tearleads/validators/operation";

/**
 * The low-level transport surfaces the API client implements. Every
 * registered HTTP operation must resolve to exactly one surface; the
 * registry-wide guard in operationTransportSurface.test.ts fails when an
 * operation shape is claimed by none or by more than one.
 */
export type OperationTransportSurface =
  | "binaryRequest"
  | "binaryResponse"
  | "json";

function supportsJsonSurface(operation: HttpOperation): boolean {
  return (
    (operation.requestMediaType ?? "application/json") === "application/json" &&
    Object.values(operation.responseMediaTypes ?? {}).every(
      (mediaType) => mediaType === "application/json",
    )
  );
}

function supportsBinaryRequestSurface(operation: HttpOperation): boolean {
  return (
    operation.requestMediaType === "application/octet-stream" &&
    operation.body === BinaryBodySchema &&
    Object.values(operation.responseMediaTypes ?? {}).every(
      (mediaType) => mediaType === "application/json",
    )
  );
}

// Empty-success statuses are excluded until the binary envelope models them;
// a binary operation that declares one must fail classification loudly
// instead of silently losing transport support.
function supportsBinaryResponseSurface(operation: HttpOperation): boolean {
  const responseStatuses = Object.keys(operation.responses).map(Number);
  return (
    (operation.requestMediaType ?? "application/json") === "application/json" &&
    (operation.emptyResponseStatuses?.length ?? 0) === 0 &&
    responseStatuses.length > 0 &&
    responseStatuses.every(
      (status) =>
        operation.responseMediaTypes?.[status] === "application/octet-stream",
    )
  );
}

const surfacePredicates: Readonly<
  Record<OperationTransportSurface, (operation: HttpOperation) => boolean>
> = {
  binaryRequest: supportsBinaryRequestSurface,
  binaryResponse: supportsBinaryResponseSurface,
  json: supportsJsonSurface,
};

const surfaceLabels: Readonly<Record<OperationTransportSurface, string>> = {
  binaryRequest: "binary request",
  binaryResponse: "binary response",
  json: "JSON",
};

const allSurfaces: readonly OperationTransportSurface[] = [
  "binaryRequest",
  "binaryResponse",
  "json",
];

export function matchedOperationTransportSurfaces(
  operation: HttpOperation,
): readonly OperationTransportSurface[] {
  return allSurfaces.filter((surface) => surfacePredicates[surface](operation));
}

export function operationTransportSurface(
  operation: HttpOperation,
): OperationTransportSurface | null {
  const matched = matchedOperationTransportSurfaces(operation);
  return matched.length === 1 ? (matched[0] ?? null) : null;
}

export function requireOperationTransportSurface(
  operation: HttpOperation,
  surface: OperationTransportSurface,
): void {
  if (operationTransportSurface(operation) !== surface) {
    throw new TypeError(
      `Unsupported ${surfaceLabels[surface]} transport operation: ${operation.id}`,
    );
  }
}
