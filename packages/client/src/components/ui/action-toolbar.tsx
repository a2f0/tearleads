import {
  Download,
  Loader2,
  type LucideIcon,
  Share2,
  Trash2
} from 'lucide-react';
import { Button } from './button';

export type ActionType = 'download' | 'share' | 'delete';

interface ActionToolbarProps {
  onDownload?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  loadingAction?: ActionType | null;
  canShare?: boolean;
  disabled?: boolean;
}

interface ActionButtonConfig {
  type: ActionType;
  onAction: (() => void) | undefined;
  Icon: LucideIcon;
  label: string;
  testId: string;
  shouldRender: boolean;
}

export function ActionToolbar({
  onDownload,
  onShare,
  onDelete,
  loadingAction = null,
  canShare = true,
  disabled = false
}: ActionToolbarProps) {
  const isDisabled = disabled || loadingAction !== null;

  const buttons: ActionButtonConfig[] = [
    {
      type: 'download',
      onAction: onDownload,
      Icon: Download,
      label: 'Download',
      testId: 'download-button',
      shouldRender: !!onDownload
    },
    {
      type: 'share',
      onAction: onShare,
      Icon: Share2,
      label: 'Share',
      testId: 'share-button',
      shouldRender: !!onShare && canShare
    },
    {
      type: 'delete',
      onAction: onDelete,
      Icon: Trash2,
      label: 'Delete',
      testId: 'delete-button',
      shouldRender: !!onDelete
    }
  ];

  return (
    <div className="flex gap-1">
      {buttons
        .filter((button) => button.shouldRender)
        .map(({ type, onAction, Icon, label, testId }) => (
          <Button
            key={type}
            variant="outline"
            size="icon"
            onClick={onAction}
            disabled={isDisabled}
            aria-label={label}
            title={label}
            data-testid={testId}
          >
            {loadingAction === type ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Icon />
            )}
          </Button>
        ))}
    </div>
  );
}
