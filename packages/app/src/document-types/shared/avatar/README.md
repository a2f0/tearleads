# Document avatars

Every document kind that keeps a photo gallery can choose one of its photos as
its avatar. Contacts, appliances, and tools all work this way through the same
modules, so a new kind gets avatars by declaring a gallery, not by writing its
own avatar code.

## Adding avatars to a kind

1. Give the kind's definition a `photos` capability
   ([`DocumentPhotoCapability`](../documentPhotos.ts)): the gallery's slot ID
   and the `avatarFallbackIcon` drawn in the circle before a photo is chosen.
   Pass the capability to `structuredFieldsProjector` so the projection keeps
   the selection field. Equipment kinds get their capability from
   [`createEquipmentDocumentType`](../equipmentDocumentDefinition.ts).
2. Render [`DocumentAvatar`](DocumentAvatar.tsx) in the document's `leading`
   slot. It offers the gallery's photos, the camera, an upload with a circular
   crop, and removal.

Explorer then shows the avatar in place of the kind's glyph. It finds kinds
with galleries through `getDocumentPhotoCapability` in the
[registry](../../registry.ts).

## Modules

- [`documentPhotos.ts`](../documentPhotos.ts) stores the selection as the
  `avatarPhotoSlotId` field. It names a gallery photo, which may have a cached
  square crop.
- [`documentAvatarRef.ts`](documentAvatarRef.ts) resolves the selection to the
  blob a list row loads.
- [`useAvatarUrls.ts`](useAvatarUrls.ts) turns refs into object URLs and
  revokes them when they change.
- [`useDocumentAvatarUrls.ts`](useDocumentAvatarUrls.ts) reads listed
  documents' avatars from their stores. It opens each store on demand, so a
  listing never starts a remote sync. Explorer uses it for the loaded window of
  its item list.
- [`DocumentAvatarImage.tsx`](DocumentAvatarImage.tsx) draws the circle on
  every surface: the document, the Contacts list, and Explorer rows and tiles.
