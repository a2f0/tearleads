import {
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { CornerUpLeft, Forward, ReplyAll } from 'lucide-react';
import type { ComposeMode } from '../lib/quoteText.js';

interface EmailDetailActionsProps {
  onComposeForMode: (mode: ComposeMode) => void;
}

export function EmailDetailActions({
  onComposeForMode
}: EmailDetailActionsProps) {
  return (
    <WindowControlGroup>
      <WindowControlButton
        icon={<CornerUpLeft className="h-3 w-3" />}
        onClick={() => onComposeForMode('reply')}
        data-testid="email-action-reply"
      >
        Reply
      </WindowControlButton>
      <WindowControlButton
        icon={<ReplyAll className="h-3 w-3" />}
        onClick={() => onComposeForMode('replyAll')}
        data-testid="email-action-reply-all"
      >
        Reply All
      </WindowControlButton>
      <WindowControlButton
        icon={<Forward className="h-3 w-3" />}
        onClick={() => onComposeForMode('forward')}
        data-testid="email-action-forward"
      >
        Forward
      </WindowControlButton>
    </WindowControlGroup>
  );
}
