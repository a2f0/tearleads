export type MediaDragType = 'audio' | 'video' | 'image';

const MEDIA_DRAG_MIME_TYPE = 'application/x-rapid-media-ids';

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}

export function setMediaDragData(
  event: {
    dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>;
  },
  mediaType: MediaDragType,
  ids: string[]
): void {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(
    MEDIA_DRAG_MIME_TYPE,
    JSON.stringify({ mediaType, ids: uniqueIds })
  );
  event.dataTransfer.setData('text/plain', uniqueIds.join(','));
}

export function getMediaDragIds(
  dataTransfer: Pick<DataTransfer, 'getData'>,
  mediaType: MediaDragType
): string[] {
  const raw = dataTransfer.getData(MEDIA_DRAG_MIME_TYPE);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];

    const mediaTypeValue = 'mediaType' in parsed ? parsed.mediaType : undefined;
    if (mediaTypeValue !== mediaType) return [];

    const idsValue = 'ids' in parsed ? parsed.ids : undefined;
    return parseIds(idsValue);
  } catch {
    return [];
  }
}
