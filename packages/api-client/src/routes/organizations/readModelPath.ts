import { pathSegment } from "../path";

export function organizationReadModelPath(
  organizationId: string,
  cursor: string | undefined,
): string {
  const path = `/organizations/${pathSegment(organizationId)}/read-model`;
  if (cursor === undefined) {
    return path;
  }

  const params = new URLSearchParams({ cursor });
  return `${path}?${params.toString()}`;
}
