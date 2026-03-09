import { Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AudioListHeaderProps {
  isUnlocked: boolean;
  children?: React.ReactNode;
}

export function AudioListHeader({
  isUnlocked,
  children
}: AudioListHeaderProps) {
  const { t } = useTranslation('audio');
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Music className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold text-sm">{t('audio')}</h2>
      </div>
      {isUnlocked ? children : null}
    </div>
  );
}
