import { describe, expect, it } from 'vitest';
import { getMediaDragIds, setMediaDragData } from './mediaDragData';

function createDragEventStub() {
  const data = new Map<string, string>();
  const dataTransfer: {
    effectAllowed: DataTransfer['effectAllowed'];
    setData: (type: string, value: string) => void;
    getData: (type: string) => string;
  } = {
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? ''
  };

  return {
    dataTransfer,
    data
  };
}

describe('mediaDragData', () => {
  it('stores and retrieves ids for matching media type', () => {
    const event = createDragEventStub();
    setMediaDragData(event, 'image', ['photo-1', 'photo-2', 'photo-1']);

    expect(event.dataTransfer.effectAllowed).toBe('copy');
    expect(getMediaDragIds(event.dataTransfer, 'image')).toEqual([
      'photo-1',
      'photo-2'
    ]);
  });

  it('returns empty ids for invalid or mismatched payloads', () => {
    const event = createDragEventStub();
    event.dataTransfer.setData(
      'application/x-rapid-media-ids',
      JSON.stringify({ mediaType: 'video', ids: ['video-1'] })
    );
    expect(getMediaDragIds(event.dataTransfer, 'image')).toEqual([]);

    event.dataTransfer.setData('application/x-rapid-media-ids', 'not-json');
    expect(getMediaDragIds(event.dataTransfer, 'video')).toEqual([]);
  });

  it('returns empty ids when payload ids are not an array', () => {
    const event = createDragEventStub();
    event.dataTransfer.setData(
      'application/x-rapid-media-ids',
      JSON.stringify({ mediaType: 'image', ids: 'photo-1' })
    );

    expect(getMediaDragIds(event.dataTransfer, 'image')).toEqual([]);
  });

  it('does not set drag data when ids are empty', () => {
    const event = createDragEventStub();
    setMediaDragData(event, 'image', []);

    expect(event.data.size).toBe(0);
    expect(event.dataTransfer.effectAllowed).toBe('none');
  });
});
