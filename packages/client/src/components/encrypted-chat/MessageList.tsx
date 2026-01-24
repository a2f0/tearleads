import { MessageSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  isOwn: boolean;
}

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold text-lg">No messages yet</h3>
        <p className="mt-2 max-w-sm text-muted-foreground text-sm">
          Send a message to start the conversation. All messages are end-to-end
          encrypted.
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          isOwn={message.isOwn}
          {...(!message.isOwn && { senderName: message.senderName })}
          senderInitial={message.senderName.charAt(0).toUpperCase()}
          timestamp={message.timestamp}
        >
          {message.content}
        </MessageBubble>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
