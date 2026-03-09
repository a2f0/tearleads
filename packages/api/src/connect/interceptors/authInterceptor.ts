import { Code, ConnectError, type Interceptor } from '@connectrpc/connect';
import { AuthService } from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import { verifyJwt } from '../../lib/jwt.js';
import { getSession, updateSessionActivity } from '../../lib/sessions.js';
import { CONNECT_AUTH_CONTEXT_KEY } from '../context.js';

const AUTH_HEADER_PREFIX = 'Bearer ';
const AUTH_SERVICE_METHOD_PATH = AuthService.typeName;

const AUTH_EXEMPT_METHODS = new Set([
  `${AUTH_SERVICE_METHOD_PATH}/Login`,
  `${AUTH_SERVICE_METHOD_PATH}/Register`,
  `${AUTH_SERVICE_METHOD_PATH}/RefreshToken`
]);

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith(AUTH_HEADER_PREFIX)) {
    return null;
  }
  const token = authHeader.slice(AUTH_HEADER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function methodPath(serviceTypeName: string, methodName: string): string {
  return `${serviceTypeName}/${methodName}`;
}

export const authInterceptor: Interceptor = (next) => async (req) => {
  const currentMethodPath = methodPath(req.service.typeName, req.method.name);
  if (AUTH_EXEMPT_METHODS.has(currentMethodPath)) {
    return next(req);
  }

  const token = extractBearerToken(req.header.get('authorization'));
  if (!token) {
    throw new ConnectError('Unauthorized', Code.Unauthenticated);
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new ConnectError('Failed to authenticate', Code.Internal);
  }

  const claims = verifyJwt(token, jwtSecret);
  if (!claims) {
    throw new ConnectError('Unauthorized', Code.Unauthenticated);
  }

  try {
    const session = await getSession(claims.jti);
    if (!session || session.userId !== claims.sub) {
      throw new ConnectError('Unauthorized', Code.Unauthenticated);
    }

    req.contextValues.set(CONNECT_AUTH_CONTEXT_KEY, {
      claims,
      session
    });

    void updateSessionActivity(claims.jti).catch((error: unknown) => {
      console.error('Failed to update session activity', error);
    });

    return next(req);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to authenticate request', error);
    throw new ConnectError('Failed to authenticate', Code.Internal);
  }
};
