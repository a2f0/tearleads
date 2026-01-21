import { createHmac } from 'node:crypto';

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

export function createJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const fullPayload: Record<string, unknown> = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');

  return `${data}.${signature}`;
}
