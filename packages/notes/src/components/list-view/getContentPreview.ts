export function getContentPreview(content: string) {
  const plainText = content
    .replace(/^#+\s/gm, '')
    .replace(/[*_`[\]~]/g, '')
    .trim();

  if (plainText.length > 100) {
    return `${plainText.substring(0, 100)}...`;
  }

  return plainText || 'No content';
}
