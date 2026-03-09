const CONTACT_DRAG_MIME_TYPE = 'application/x-tearleads-contact-ids';

interface ContactDragDataWriter {
  effectAllowed: string;
  setData: (format: string, data: string) => void;
}

interface ContactDragDataReader {
  getData: (format: string) => string;
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}

export function setContactDragData(
  event: { dataTransfer: ContactDragDataWriter },
  contactIds: string[]
): void {
  const uniqueIds = Array.from(new Set(contactIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(
    CONTACT_DRAG_MIME_TYPE,
    JSON.stringify({ ids: uniqueIds })
  );
  event.dataTransfer.setData('text/plain', uniqueIds.join(','));
}

export function getContactDragIds(
  dataTransfer: ContactDragDataReader
): string[] {
  const raw = dataTransfer.getData(CONTACT_DRAG_MIME_TYPE);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];

    const idsValue = 'ids' in parsed ? parsed.ids : undefined;
    return parseIds(idsValue);
  } catch {
    return [];
  }
}
