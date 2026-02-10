export function isDuplicateConstraintError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    err.message.includes('duplicate key value violates unique constraint')
  );
}
