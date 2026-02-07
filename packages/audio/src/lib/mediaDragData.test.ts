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
    setMediaDragData(event, 'audio', ['audio-1', 'audio-2', 'audio-1']);

    expect(event.dataTransfer.effectAllowed).toBe('copy');
    expect(getMediaDragIds(event.dataTransfer, 'audio')).toEqual([
      'audio-1',
      'audio-2'
    ]);
  });

  it('returns empty ids for invalid payloads', () => {
    const event = createDragEventStub();
    event.dataTransfer.setData(
      'application/x-rapid-media-ids',
      JSON.stringify({ mediaType: 'video', ids: ['video-1'] })
    );
    expect(getMediaDragIds(event.dataTransfer, 'audio')).toEqual([]);

    event.dataTransfer.setData('application/x-rapid-media-ids', 'not-json');
    expect(getMediaDragIds(event.dataTransfer, 'audio')).toEqual([]);
  });

  it('returns empty ids when payload ids are not an array', () => {
    const event = createDragEventStub();
    event.dataTransfer.setData(
      'application/x-rapid-media-ids',
      JSON.stringify({ mediaType: 'audio', ids: 'audio-1' })
    );

    expect(getMediaDragIds(event.dataTransfer, 'audio')).toEqual([]);
  });

  it('does not set drag data when ids are empty', () => {
    const event = createDragEventStub();
    setMediaDragData(event, 'audio', []);

    expect(event.data.size).toBe(0);
    expect(event.dataTransfer.effectAllowed).toBe('none');
  });
});
