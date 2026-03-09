function buildMailtoUrl(recipients: string[]): string | null {
  const normalizedRecipients = Array.from(
    new Set(
      recipients
        .map((recipient) => recipient.trim())
        .filter((recipient) => recipient.length > 0)
    )
  );

  if (normalizedRecipients.length === 0) {
    return null;
  }

  return `mailto:${normalizedRecipients.map(encodeURIComponent).join(',')}`;
}

export function openComposeEmail(
  recipients: string[],
  openComposer?: (recipients: string[]) => boolean
): boolean {
  const normalizedRecipients = Array.from(
    new Set(
      recipients
        .map((recipient) => recipient.trim())
        .filter((recipient) => recipient.length > 0)
    )
  );
  if (normalizedRecipients.length === 0) {
    return false;
  }

  if (openComposer) {
    return openComposer(normalizedRecipients);
  }

  const mailtoUrl = buildMailtoUrl(normalizedRecipients);
  if (!mailtoUrl || typeof window === 'undefined') {
    return false;
  }

  window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
  return true;
}
