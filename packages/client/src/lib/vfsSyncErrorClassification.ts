function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const HTTP_UNAUTHORIZED_STATUS = 401;
const CONNECT_CODE_UNAUTHENTICATED = 16;
const MAX_LINKED_ERROR_NODES = 40;
const LINKED_ERROR_FIELDS = [
  'cause',
  'error',
  'err',
  'originalError',
  'innerError',
  'reason',
  'details',
  'response',
  'body',
  'data'
] as const;

function renderErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (!isRecord(error)) {
    return '';
  }

  const name = typeof error['name'] === 'string' ? error['name'] : '';
  const message = typeof error['message'] === 'string' ? error['message'] : '';

  return `${name} ${message}`.trim();
}

function enumerateLinkedErrors(error: unknown): unknown[] {
  const queue: unknown[] = [error];
  const visitedObjects = new Set<object>();
  if (typeof error === 'object' && error !== null) {
    visitedObjects.add(error);
  }
  const linkedErrors: unknown[] = [];

  while (queue.length > 0 && linkedErrors.length < MAX_LINKED_ERROR_NODES) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    linkedErrors.push(current);

    if (!isRecord(current)) {
      continue;
    }

    for (const field of LINKED_ERROR_FIELDS) {
      const nested = current[field];
      if (nested === undefined || nested === null) {
        continue;
      }
      if (typeof nested === 'object') {
        if (visitedObjects.has(nested)) {
          continue;
        }
        visitedObjects.add(nested);
      }
      queue.push(nested);
    }

    const nestedErrors = current['errors'];
    if (Array.isArray(nestedErrors)) {
      for (const nested of nestedErrors) {
        if (typeof nested === 'object' && nested !== null) {
          if (visitedObjects.has(nested)) {
            continue;
          }
          visitedObjects.add(nested);
        }
        queue.push(nested);
      }
    }
  }

  return linkedErrors;
}

function hasUnauthorizedErrorCode(value: Record<string, unknown>): boolean {
  const status = value['status'];
  if (typeof status === 'number' && status === HTTP_UNAUTHORIZED_STATUS) {
    return true;
  }

  const statusCode = value['statusCode'];
  if (
    typeof statusCode === 'number' &&
    statusCode === HTTP_UNAUTHORIZED_STATUS
  ) {
    return true;
  }

  const code = value['code'];
  if (typeof code === 'number') {
    return (
      code === HTTP_UNAUTHORIZED_STATUS || code === CONNECT_CODE_UNAUTHENTICATED
    );
  }
  if (typeof code === 'string') {
    const normalizedCode = code.toLowerCase();
    return (
      normalizedCode === 'unauthorized' || normalizedCode === 'unauthenticated'
    );
  }

  return false;
}

function hasUnauthorizedErrorMessage(value: unknown): boolean {
  const renderedMessage = renderErrorMessage(value).toLowerCase();
  return (
    renderedMessage.includes('unauthorized') ||
    renderedMessage.includes('unauthenticated') ||
    /api error:\s*401\b/iu.test(renderedMessage)
  );
}

export function isVfsUnauthorizedError(error: unknown): boolean {
  for (const candidate of enumerateLinkedErrors(error)) {
    if (isRecord(candidate) && hasUnauthorizedErrorCode(candidate)) {
      return true;
    }

    if (hasUnauthorizedErrorMessage(candidate)) {
      return true;
    }
  }
  return false;
}

function hasDatabaseNotInitializedCode(
  value: Record<string, unknown>
): boolean {
  const code = value['code'];
  return (
    typeof code === 'string' &&
    code.toLowerCase() === 'database_not_initialized'
  );
}

export function isVfsDatabaseNotInitializedError(error: unknown): boolean {
  for (const candidate of enumerateLinkedErrors(error)) {
    if (isRecord(candidate) && hasDatabaseNotInitializedCode(candidate)) {
      return true;
    }

    if (
      renderErrorMessage(candidate)
        .toLowerCase()
        .includes('database not initialized')
    ) {
      return true;
    }
  }
  return false;
}

export function isVfsTransientInstanceSwitchError(error: unknown): boolean {
  return (
    isVfsUnauthorizedError(error) || isVfsDatabaseNotInitializedError(error)
  );
}
