import { ThreadPrimitive } from '@assistant-ui/react';
import { Bot, ImageIcon } from 'lucide-react';
import { AssistantMessage } from './AssistantMessage';
import { Composer } from './Composer';
import { UserMessage } from './UserMessage';

interface ThreadProps {
  isVisionModel: boolean;
  attachedImage: string | null;
  onAttachImage: () => void;
  onRemoveImage: () => void;
}

export function Thread({
  isVisionModel,
  attachedImage,
  onAttachImage,
  onRemoveImage
}: ThreadProps) {
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4">
        <ThreadPrimitive.Empty>
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Bot className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-4">Send a message to start chatting</p>
              {isVisionModel && (
                <p className="mt-2 text-sm">
                  Attach an image using the{' '}
                  <ImageIcon className="inline h-4 w-4" /> button
                </p>
              )}
            </div>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage
          }}
        />
      </ThreadPrimitive.Viewport>
      <Composer
        isVisionModel={isVisionModel}
        attachedImage={attachedImage}
        onAttachImage={onAttachImage}
        onRemoveImage={onRemoveImage}
      />
    </ThreadPrimitive.Root>
  );
}
