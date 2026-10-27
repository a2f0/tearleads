type BrowserHeaders = {
  host?: string | null | undefined;
  origin?: string | null | undefined;
  site?: string | null | undefined;
};

/** Host checks stop DNS rebinding; Origin/site checks stop cross-site requests. */
export function browserRequestAllowed(
  headers: BrowserHeaders,
  port: number,
  portalPort: number,
): boolean {
  const authority = `127.0.0.1:${port}`;
  if (headers.host !== authority || headers.site === "cross-site") return false;
  return (
    headers.origin == null ||
    headers.origin === `http://${authority}` ||
    headers.origin === `http://127.0.0.1:${portalPort}`
  );
}
