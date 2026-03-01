/**
 * Check if a file matches an accept string.
 * Supports wildcards (e.g., "image/*") and comma-separated lists.
 *
 * @param file - The file to check
 * @param accept - Accept string (e.g., "image/*", "video/*,audio/*", ".iso")
 * @returns true if the file matches the accept criteria
 */
function fileMatchesAccept(file: File, accept: string): boolean {
  if (!accept || accept.trim() === '') {
    return true;
  }

  const acceptParts = accept.split(',').map((part) => part.trim());

  for (const part of acceptParts) {
    // Handle extension patterns (e.g., ".iso", ".pdf")
    if (part.startsWith('.')) {
      if (file.name.toLowerCase().endsWith(part.toLowerCase())) {
        return true;
      }
      continue;
    }

    // Handle MIME type patterns
    if (part.includes('/')) {
      // Handle wildcard (e.g., "image/*")
      if (part.endsWith('/*')) {
        const baseType = part.slice(0, -2);
        if (file.type.startsWith(`${baseType}/`)) {
          return true;
        }
      } else {
        // Exact MIME type match
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
 *
 * @param files - Array of files to filter
 * @param accept - Accept string (e.g., "image/*", "video/*,audio/*", ".iso")
 * @returns Filtered array of matching files
 */
export function filterFilesByAccept(files: File[], accept?: string): File[] {
  if (!accept || accept.trim() === '') {
    return files;
  }

  return files.filter((file) => fileMatchesAccept(file, accept));
}
