import { ImageIcon } from 'lucide-react';

export function PhotosContentHeader() {
  return (
    <div className="flex items-center gap-2">
      <ImageIcon className="h-4 w-4 text-muted-foreground" />
      <p className="font-medium text-sm">Photos</p>
    </div>
  );
}
