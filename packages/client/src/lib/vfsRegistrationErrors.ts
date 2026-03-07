const HTTP_CONFLICT = 409;

function parseStatusCode(error: Error): number | null {
  const status = Reflect.get(error, 'status');
  if (typeof status === 'number' && Number.isInteger(status)) {
    return status;
  }
  if (typeof status === 'string' && /^[0-9]+$/u.test(status)) {
    return Number.parseInt(status, 10);
  }
  return null;
}

export function isVfsAlreadyRegisteredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (parseStatusCode(error) === HTTP_CONFLICT) {
    return true;
  }

  const normalizedMessage = error.message.toLowerCase();
  return (
    normalizedMessage.includes('already registered') ||
    normalizedMessage.includes('already exists')
  );
}
