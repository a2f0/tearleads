export type EmailStorageBackend = 'redis' | 'vfs';

export function getEmailStorageBackend(): EmailStorageBackend {
  const configured = process.env['EMAIL_STORAGE_BACKEND']?.trim().toLowerCase();
  if (configured === 'vfs') {
    return 'vfs';
  }
  return 'redis';
}
