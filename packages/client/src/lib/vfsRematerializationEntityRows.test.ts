import { describe, expect, it } from 'vitest';
import {
  buildMaterializedCollectionRows,
  buildMaterializedFileRows
} from './vfsRematerializationEntityRows';

describe('vfsRematerializationEntityRows', () => {
  it('builds collection extension rows for album/playlist object types', () => {
    const rows = buildMaterializedCollectionRows([
      {
        id: 'album-1',
        objectType: 'album',
        encryptedName: 'Shard Photos',
        createdAt: new Date('2026-03-04T00:00:00.000Z')
      },
      {
        id: 'playlist-1',
        objectType: 'playlist',
        encryptedName: 'Roadtrip',
        createdAt: new Date('2026-03-04T00:00:00.000Z')
      },
      {
        id: 'photo-1',
        objectType: 'photo',
        encryptedName: 'cover.jpg',
        createdAt: new Date('2026-03-04T00:00:00.000Z')
      }
    ]);

    expect(rows.albumRows).toEqual([
      {
        id: 'album-1',
        encryptedName: 'Shard Photos',
        encryptedDescription: null,
        coverPhotoId: null,
        albumType: 'custom'
      }
    ]);
    expect(rows.playlistRows).toEqual([
      {
        id: 'playlist-1',
        encryptedName: 'Roadtrip',
        encryptedDescription: null,
        coverImageId: null,
        shuffleMode: 0,
        mediaType: 'audio'
      }
    ]);
  });

  it('builds file rows with inferred mime types and fallbacks', () => {
    const createdAt = new Date('2026-03-04T01:02:03.000Z');
    const encodedPayload = Buffer.from('hello').toString('base64');

    const rows = buildMaterializedFileRows(
      [
        {
          id: 'file-svg',
          objectType: 'file',
          encryptedName: 'diagram.svg',
          createdAt
        },
        {
          id: 'file-png',
          objectType: 'file',
          encryptedName: 'image.png',
          createdAt
        },
        {
          id: 'photo-jpg',
          objectType: 'photo',
          encryptedName: 'photo.jpg',
          createdAt
        },
        {
          id: 'photo-jpeg',
          objectType: 'photo',
          encryptedName: 'photo.jpeg',
          createdAt
        },
        {
          id: 'photo-gif',
          objectType: 'photo',
          encryptedName: 'anim.gif',
          createdAt
        },
        {
          id: 'photo-webp',
          objectType: 'photo',
          encryptedName: 'still.webp',
          createdAt
        },
        {
          id: 'audio-mp3',
          objectType: 'audio',
          encryptedName: 'song.mp3',
          createdAt
        },
        {
          id: 'audio-wav',
          objectType: 'audio',
          encryptedName: 'voice.wav',
          createdAt
        },
        {
          id: 'audio-m4a',
          objectType: 'audio',
          encryptedName: 'memo.m4a',
          createdAt
        },
        {
          id: 'video-mp4',
          objectType: 'video',
          encryptedName: 'clip.mp4',
          createdAt
        },
        {
          id: 'video-mov',
          objectType: 'video',
          encryptedName: 'movie.mov',
          createdAt
        },
        {
          id: 'photo-fallback',
          objectType: 'photo',
          encryptedName: null,
          createdAt
        },
        {
          id: 'audio-fallback',
          objectType: 'audio',
          encryptedName: '   ',
          createdAt
        },
        {
          id: 'video-fallback',
          objectType: 'video',
          encryptedName: null,
          createdAt
        },
        {
          id: 'file-fallback',
          objectType: 'file',
          encryptedName: '',
          createdAt
        },
        {
          id: 'ignored-album',
          objectType: 'album',
          encryptedName: 'Album',
          createdAt
        }
      ],
      new Map([
        [
          'file-svg',
          {
            encryptedPayload: encodedPayload,
            deleted: true
          }
        ],
        [
          'audio-mp3',
          {
            encryptedPayload: null,
            deleted: false
          }
        ]
      ])
    );

    expect(rows).toHaveLength(15);

    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('file-svg')).toMatchObject({
      name: 'diagram.svg',
      mimeType: 'image/svg+xml',
      size: 5,
      deleted: true,
      contentHash: 'rematerialized:file-svg',
      storagePath: 'rematerialized-file-svg.enc',
      thumbnailPath: null
    });

    expect(byId.get('file-png')?.mimeType).toBe('image/png');
    expect(byId.get('photo-jpg')?.mimeType).toBe('image/jpeg');
    expect(byId.get('photo-jpeg')?.mimeType).toBe('image/jpeg');
    expect(byId.get('photo-gif')?.mimeType).toBe('image/gif');
    expect(byId.get('photo-webp')?.mimeType).toBe('image/webp');
    expect(byId.get('audio-mp3')?.mimeType).toBe('audio/mpeg');
    expect(byId.get('audio-wav')?.mimeType).toBe('audio/wav');
    expect(byId.get('audio-m4a')?.mimeType).toBe('audio/mp4');
    expect(byId.get('video-mp4')?.mimeType).toBe('video/mp4');
    expect(byId.get('video-mov')?.mimeType).toBe('video/quicktime');

    expect(byId.get('photo-fallback')).toMatchObject({
      name: 'Untitled Photo',
      mimeType: 'image/jpeg',
      size: 0,
      deleted: false
    });

    expect(byId.get('audio-fallback')).toMatchObject({
      name: 'Untitled Audio',
      mimeType: 'audio/mpeg',
      size: 0,
      deleted: false
    });

    expect(byId.get('video-fallback')).toMatchObject({
      name: 'Untitled Video',
      mimeType: 'video/mp4',
      size: 0,
      deleted: false
    });

    expect(byId.get('file-fallback')).toMatchObject({
      name: 'Untitled File',
      mimeType: 'application/octet-stream',
      size: 0,
      deleted: false
    });

    const copiedDate = byId.get('photo-jpg')?.uploadDate;
    expect(copiedDate).toBeInstanceOf(Date);
    expect(copiedDate?.getTime()).toBe(createdAt.getTime());
    expect(copiedDate).not.toBe(createdAt);
  });
});
