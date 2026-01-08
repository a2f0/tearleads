import { MessagePrimitive } from '@assistant-ui/react';
import { Bot } from 'lucide-react';
import { CustomText } from './CustomText';

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full py-2">
      <div className="flex max-w-[80%] gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="h-4 w-4" />
        </div>
        <div className="rounded-lg bg-muted px-4 py-2">
          <MessagePrimitive.Content components={{ Text: CustomText }} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}
