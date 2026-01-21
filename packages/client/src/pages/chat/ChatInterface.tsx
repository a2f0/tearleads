import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { useLLM } from '@/hooks/useLLM';
import {
  createLLMAdapter,
  getAttachedImage,
  setAttachedImage
} from '@/lib/llm-runtime';
import { PhotoPicker } from './PhotoPicker';
import { Thread } from './Thread';

interface ChatInterfaceProps {
  generate: ReturnType<typeof useLLM>['generate'];
  isVisionModel: boolean;
}

export function ChatInterface({ generate, isVisionModel }: ChatInterfaceProps) {
  const adapter = useMemo(() => createLLMAdapter(generate), [generate]);
  const runtime = useLocalRuntime(adapter);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [attachedImage, setAttachedImageState] = useState<string | null>(null);

  const handleAttachImage = useCallback(() => {
    setShowPhotoPicker(true);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setAttachedImageState(null);
    setAttachedImage(null);
  }, []);

  const handleSelectPhoto = useCallback((imageDataUrl: string) => {
    setAttachedImageState(imageDataUrl);
    setAttachedImage(imageDataUrl);
    setShowPhotoPicker(false);
  }, []);

  const handleClosePhotoPicker = useCallback(() => {
    setShowPhotoPicker(false);
  }, []);

  // Sync attached image state with the runtime module
  useEffect(() => {
    const currentImage = getAttachedImage();
    if (currentImage !== attachedImage) {
      setAttachedImageState(currentImage);
    }
  }, [attachedImage]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <Thread
          isVisionModel={isVisionModel}
          attachedImage={attachedImage}
          onAttachImage={handleAttachImage}
          onRemoveImage={handleRemoveImage}
        />
      </div>
      {showPhotoPicker && (
        <PhotoPicker
          onSelect={handleSelectPhoto}
          onClose={handleClosePhotoPicker}
        />
      )}
    </AssistantRuntimeProvider>
  );
}
