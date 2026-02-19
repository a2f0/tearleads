/**
 * Check if a file matches an accept string.
 * Supports wildcards (e.g., "image/*") and comma-separated lists.
 */
function fileMatchesAccept(file: File, accept: string): boolean {
  if (!accept || accept.trim() === '') {
    return true;
  }

  const acceptParts = accept.split(',').map((part) => part.trim());

  for (const part of acceptParts) {
    if (part.startsWith('.')) {
      if (file.name.toLowerCase().endsWith(part.toLowerCase())) {
        return true;
      }
      continue;
    }

    if (part.includes('/')) {
      if (part.endsWith('/*')) {
        const baseType = part.slice(0, -2);
        if (file.type.startsWith(`${baseType}/`)) {
          return true;
        }
      } else {
        if (file.type === part) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Filter an array of files based on an accept string.
 */
export function filterFilesByAccept(files: File[], accept?: string): File[] {
  if (!accept || accept.trim() === '') {
    return files;
  }

  return files.filter((file) => fileMatchesAccept(file, accept));
}
