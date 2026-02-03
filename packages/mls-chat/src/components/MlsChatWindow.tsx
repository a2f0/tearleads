/**
 * Main MLS chat window component.
 * Displays messages and composer for a group.
 */
import type { FC, ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { useMlsChatUI } from '../context/index.js';
import type { DecryptedMessage } from '../lib/index.js';

import { MlsComposer } from './MlsComposer.js';
import { MlsMessage } from './MlsMessage.js';

interface MlsChatWindowProps {
  groupName: string;
  messages: DecryptedMessage[];
  isLoading?: boolean;
  isSending?: boolean;
  hasMore?: boolean;
  canDecrypt?: boolean;
  onSend: (message: string) => Promise<void>;
  onLoadMore?: () => Promise<void>;
  onOpenMembers?: () => void;
  onLeaveGroup?: () => void;
}

export const MlsChatWindow: FC<MlsChatWindowProps> = ({
  groupName,
  messages,
  isLoading = false,
  isSending = false,
  hasMore = false,
  canDecrypt = true,
  onSend,
  onLoadMore,
  onOpenMembers,
  onLeaveGroup
}) => {
  const { Button, ScrollArea, DropdownMenu, DropdownMenuItem } = useMlsChatUI();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages dependency triggers scroll on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !hasMore || isLoading || !onLoadMore)
      return;

    const { scrollTop } = scrollContainerRef.current;
    if (scrollTop === 0) {
      void onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">{groupName}</h2>
          {!canDecrypt && (
            <span className="text-destructive text-xs">
              Cannot decrypt messages
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onOpenMembers && (
            <Button onClick={onOpenMembers} variant="ghost" size="icon">
              <UsersIcon />
            </Button>
          )}
          <DropdownMenu
            trigger={
              <Button variant="ghost" size="icon">
                <MoreIcon />
              </Button>
            }
          >
            {onOpenMembers && (
              <DropdownMenuItem onClick={onOpenMembers} icon={<UsersIcon />}>
                View members
              </DropdownMenuItem>
            )}
            {onLeaveGroup && (
              <DropdownMenuItem onClick={onLeaveGroup} icon={<LeaveIcon />}>
                Leave group
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex h-full flex-col-reverse overflow-y-auto p-4"
        >
          <div ref={messagesEndRef} />

          {isLoading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              No messages yet. Start the conversation!
            </div>
          ) : (
            <div className="space-y-4">
              {hasMore && (
                <div className="text-center">
                  <Button
                    onClick={() => void onLoadMore?.()}
                    variant="ghost"
                    size="sm"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Loading...' : 'Load older messages'}
                  </Button>
                </div>
              )}
              {[...messages].reverse().map((message) => (
                <MlsMessage key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Composer */}
      <MlsComposer
        onSend={onSend}
        disabled={!canDecrypt || isSending}
        placeholder={canDecrypt ? 'Type a message...' : 'Cannot send messages'}
      />
    </div>
  );
};

function UsersIcon(): ReactElement {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MoreIcon(): ReactElement {
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function LeaveIcon(): ReactElement {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}
