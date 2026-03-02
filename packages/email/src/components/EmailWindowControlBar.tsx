import {
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { ArrowLeft, Edit, RefreshCw } from 'lucide-react';

interface EmailWindowControlBarProps {
  selectedEmailId: string | null;
  activeTab: 'inbox' | 'compose';
  onBack: () => void;
  onCloseCompose: () => void;
  onCompose: () => void;
  onRefresh: () => void;
}

export function EmailWindowControlBar({
  selectedEmailId,
  activeTab,
  onBack,
  onCloseCompose,
  onCompose,
  onRefresh
}: EmailWindowControlBarProps) {
  return (
    <WindowControlBar>
      <WindowControlGroup>
        {selectedEmailId ? (
          <WindowControlButton
            icon={<ArrowLeft className="h-3 w-3" />}
            onClick={onBack}
            data-testid="email-window-control-back"
          >
            Back
          </WindowControlButton>
        ) : activeTab === 'compose' ? (
          <WindowControlButton
            icon={<ArrowLeft className="h-3 w-3" />}
            onClick={onCloseCompose}
            data-testid="email-window-control-close-compose"
          >
            Inbox
          </WindowControlButton>
        ) : (
          <>
            <WindowControlButton
              icon={<Edit className="h-3 w-3" />}
              onClick={onCompose}
              data-testid="email-window-control-compose"
            >
              Compose
            </WindowControlButton>
            <WindowControlButton
              icon={<RefreshCw className="h-3 w-3" />}
              onClick={onRefresh}
              data-testid="email-window-control-refresh"
            >
              Refresh
            </WindowControlButton>
          </>
        )}
      </WindowControlGroup>
    </WindowControlBar>
  );
}
