import { Music } from 'lucide-react';

interface AudioListHeaderProps {
  isUnlocked: boolean;
  children?: React.ReactNode;
}

export function AudioListHeader({
  isUnlocked,
  children
}: AudioListHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Music className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Audio</h2>
      </div>
      {isUnlocked ? children : null}
    </div>
  );
}
