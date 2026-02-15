import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAIUIContext } from '../../context';
import { createLLMAdapter } from '../../lib';
import { Thread } from './Thread';

export function ChatInterface() {
  const { llm, selectPhoto, imageAttachment } = useAIUIContext();
  const isVisionModel =
    llm.modelType === 'vision' || llm.modelType === 'paligemma';

  const adapter = useMemo(() => createLLMAdapter(llm.generate), [llm.generate]);
  const runtime = useLocalRuntime(adapter);
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
