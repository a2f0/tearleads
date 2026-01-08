import { MessagePrimitive } from '@assistant-ui/react';

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-end py-2">
      <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}
