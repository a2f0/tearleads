/**
 * Custom error types for the application.
 */

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
