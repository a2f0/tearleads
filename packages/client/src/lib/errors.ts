/**
 * Custom error types for the application.
 */

import { isRecord } from '@rapid/shared';

/**
 * Type guard to check if a value is an Error instance.
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Safely extract an error message from an unknown error value.
 * Handles Error instances, error-like objects with a message property,
 * and falls back to String() for other values.
 */
export function getErrorMessage(error: unknown): string {
  if (isError(error)) return error.message;
  if (isRecord(error) && 'message' in error) {
    const value = error['message'];
    return typeof value === 'string' ? value : String(value);
  }
  return String(error);
}

/**
 * Convert an unknown value to an Error instance.
 * Returns the value unchanged if it's already an Error,
 * otherwise wraps it in a new Error with the best message extracted.
 */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  return new Error(getErrorMessage(value));
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
