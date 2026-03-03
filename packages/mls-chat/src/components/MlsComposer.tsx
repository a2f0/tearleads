/**
 * Message composer for MLS chat.
 * Input field with send button for encrypted messages.
 */
import type { FC, FormEvent, KeyboardEvent } from 'react';
import { useCallback, useState } from 'react';

import { useMlsChatUI } from '../context/index.js';
import { MlsComposerLockIcon } from './MlsComposerLockIcon.js';
import { MlsComposerSendIcon } from './MlsComposerSendIcon.js';

interface MlsComposerProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export const MlsComposer: FC<MlsComposerProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Type a message...'
}) => {
  const { Button, Input } = useMlsChatUI();

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const submitMessage = useCallback(async (): Promise<void> => {
    const trimmed = message.trim();
    if (!trimmed || isSending || disabled) return;

    setIsSending(true);
    try {
      await onSend(trimmed);
      setMessage('');
    } finally {
      setIsSending(false);
    }
  }, [message, isSending, disabled, onSend]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void submitMessage();
    },
    [submitMessage]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submitMessage();
      }
    },
    [submitMessage]
  );

  return (
    <form onSubmit={handleSubmit} className="border-t p-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            value={message}
            onChange={setMessage}
            placeholder={placeholder}
            disabled={disabled || isSending}
            className="text-base"
          />
        </div>
        <Button
          onClick={() => void submitMessage()}
          disabled={!message.trim() || isSending || disabled}
          size="icon"
        >
          {isSending ? (
            <span className="h-4 w-4 animate-spin">...</span>
          ) : (
            <MlsComposerSendIcon />
          )}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1 text-muted-foreground text-xs">
        <MlsComposerLockIcon />
        <span>MLS mode (experimental)</span>
      </div>
      <input type="hidden" onKeyDown={handleKeyDown} />
    </form>
  );
};
