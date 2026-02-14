import { ArrowLeft, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FileDetailHeaderProps {
  canDelete: boolean;
  onBack: () => void;
  onDeleteRequest: () => void;
  actionsDisabled: boolean;
}

export function FileDetailHeader({
  canDelete,
  onBack,
  onDeleteRequest,
  actionsDisabled
}: FileDetailHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="h-7 px-2"
        data-testid="window-file-back"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDeleteRequest}
          disabled={actionsDisabled}
          className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
          data-testid="window-file-delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
