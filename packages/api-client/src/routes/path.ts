export function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}
