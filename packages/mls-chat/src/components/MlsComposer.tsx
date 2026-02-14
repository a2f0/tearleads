/**
 * Message composer for MLS chat.
 * Input field with send button for encrypted messages.
 */
import type { FC, FormEvent, KeyboardEvent, ReactElement } from 'react';
import { useCallback, useState } from 'react';

import { useMlsChatUI } from '../context/index.js';

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
            <SendIcon />
          )}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1 text-muted-foreground text-xs">
        <LockIcon />
        <span>End-to-end encrypted</span>
      </div>
      <input type="hidden" onKeyDown={handleKeyDown} />
    </form>
  );
};

function SendIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function LockIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
