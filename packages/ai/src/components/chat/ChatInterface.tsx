import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAIUIContext } from '../../context';
import { createLLMAdapter } from '../../lib';
import { Thread } from './Thread';

export function ChatInterface() {
  const { llm, conversations, selectPhoto, imageAttachment } = useAIUIContext();
  const isVisionModel =
    llm.modelType === 'vision' || llm.modelType === 'paligemma';

  const initialMessages = useMemo(
    () =>
      conversations.currentMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: new Date(message.createdAt)
      })),
    [conversations.currentMessages]
  );

  const adapter = useMemo(
    () =>
      createLLMAdapter(llm.generate, {
        canPersist: () => {
          return (
            Boolean(conversations.currentId) && !conversations.messagesLoading
          );
        },
        onUserMessage: async (content: string) => {
          await conversations.addMessage(
            'user',
            content,
            llm.loadedModel ?? undefined
          );
        },
        onAssistantMessage: async (content: string) => {
          await conversations.addMessage(
            'assistant',
            content,
            llm.loadedModel ?? undefined
          );
        }
      }),
    [
      llm.generate,
      llm.loadedModel,
      conversations.currentId,
      conversations.messagesLoading,
      conversations.addMessage
    ]
  );
  const runtime = useLocalRuntime(adapter, { initialMessages });
  const [attachedImage, setAttachedImageState] = useState<string | null>(null);

  const handleAttachImage = useCallback(async () => {
    if (selectPhoto) {
      const imageDataUrl = await selectPhoto();
      if (imageDataUrl) {
        setAttachedImageState(imageDataUrl);
        imageAttachment.setAttachedImage(imageDataUrl);
      }
    }
  }, [selectPhoto, imageAttachment]);

  const handleRemoveImage = useCallback(() => {
    setAttachedImageState(null);
    imageAttachment.setAttachedImage(null);
  }, [imageAttachment]);

  // Sync attached image state with the runtime module
  useEffect(() => {
    const currentImage = imageAttachment.getAttachedImage();
    if (currentImage !== attachedImage) {
      setAttachedImageState(currentImage);
    }
  }, [attachedImage, imageAttachment]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        data-testid="chat-interface-container"
        className="flex h-full flex-col overflow-hidden"
      >
        <Thread
          isVisionModel={isVisionModel}
          attachedImage={attachedImage}
          onAttachImage={handleAttachImage}
          onRemoveImage={handleRemoveImage}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
