export type AlbumType = 'photoroll' | 'custom';

export interface PhotoAlbum {
  id: string;
  name: string;
  photoCount: number;
  coverPhotoId: string | null;
  albumType: AlbumType;
}

type SystemAlbumType = Exclude<AlbumType, 'custom'>;

export const SYSTEM_ALBUM_TYPES: SystemAlbumType[] = ['photoroll'];

export const SYSTEM_ALBUM_NAMES: Record<SystemAlbumType, string> = {
  photoroll: 'Photo Roll'
};

export function isSystemAlbum(album: PhotoAlbum): boolean {
  return (SYSTEM_ALBUM_TYPES as readonly string[]).includes(album.albumType);
}

export function canDeleteAlbum(album: PhotoAlbum): boolean {
  return album.albumType === 'custom';
}

export function canRenameAlbum(album: PhotoAlbum): boolean {
  return album.albumType === 'custom';
}
