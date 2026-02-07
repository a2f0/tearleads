import { describe, expect, it } from 'vitest';
import { getMediaDragIds, setMediaDragData } from './mediaDragData';

function createDragEventStub() {
  const data = new Map<string, string>();
  return {
    dataTransfer: {
      effectAllowed: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    },
    data
  };
}

describe('mediaDragData', () => {
  it('stores and retrieves ids for matching media type', () => {
    const event = createDragEventStub();
    setMediaDragData(
      event as unknown as React.DragEvent,
      'audio',
      ['audio-1', 'audio-2', 'audio-1']
    );

    expect(event.dataTransfer.effectAllowed).toBe('copy');
    expect(getMediaDragIds(event.dataTransfer as DataTransfer, 'audio')).toEqual(
      ['audio-1', 'audio-2']
    );
  });

  it('returns empty ids for invalid payloads', () => {
    const event = createDragEventStub();
    event.dataTransfer.setData(
      'application/x-rapid-media-ids',
      JSON.stringify({ mediaType: 'video', ids: ['video-1'] })
    );
    expect(getMediaDragIds(event.dataTransfer as DataTransfer, 'audio')).toEqual(
      []
    );

    event.dataTransfer.setData('application/x-rapid-media-ids', 'not-json');
    expect(getMediaDragIds(event.dataTransfer as DataTransfer, 'audio')).toEqual(
      []
    );
  });
});
