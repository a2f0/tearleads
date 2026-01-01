/**
 * Custom error types for the application.
 */

/**
 * Type guard to check if a value is an Error instance.
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Convert an unknown value to an Error instance.
 * Returns the value unchanged if it's already an Error,
 * otherwise wraps it in a new Error.
 */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  return new Error(String(value));
}

/**
 * Safely extract an error message from an unknown error value.
 * Uses instanceof check instead of type assertion for type safety.
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) return error.message;
  return String(error);
}

/**
 * Error thrown when a file's type cannot be detected from its content.
 * This typically happens when the file has no recognizable magic bytes.
 */
export class UnsupportedFileTypeError extends Error {
  constructor(fileName: string) {
    super(
      `Unable to detect file type for "${fileName}". Only files with recognizable formats are supported.`
    );
    this.name = 'UnsupportedFileTypeError';
  }
}
