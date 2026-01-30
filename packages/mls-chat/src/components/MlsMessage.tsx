/**
 * Message bubble component for MLS chat.
 * Displays encrypted messages with sender info.
 */
import type { FC } from 'react';

import { useMlsChatUI } from '../context/index.js';
import type { DecryptedMessage } from '../lib/index.js';

interface MlsMessageProps {
  message: DecryptedMessage;
}

export const MlsMessage: FC<MlsMessageProps> = ({ message }) => {
  const { Avatar } = useMlsChatUI();

  const formattedTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(message.sentAt);

  if (message.isOwnMessage) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%]">
          <div className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">
            <p className="whitespace-pre-wrap break-words">
              {message.plaintext}
            </p>
          </div>
          <div className="mt-1 text-right text-muted-foreground text-xs">
            {formattedTime}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Avatar
        userId={message.senderUserId}
        email={message.senderEmail}
        size="sm"
      />
      <div className="max-w-[80%]">
        {message.senderEmail && (
          <div className="mb-1 text-muted-foreground text-xs">
            {message.senderEmail}
          </div>
        )}
        <div className="rounded-lg bg-muted px-4 py-2">
          <p className="whitespace-pre-wrap break-words">{message.plaintext}</p>
        </div>
        <div className="mt-1 text-muted-foreground text-xs">
          {formattedTime}
        </div>
      </div>
    </div>
  );
};
