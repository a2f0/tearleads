import type { Request } from 'express';

/**
 * Extract the client IP address from a request.
 * Handles X-Forwarded-For header for proxied requests.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) {
      return first.trim();
    }
  }
  return req.ip ?? 'unknown';
}
