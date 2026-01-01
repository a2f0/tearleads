import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime
} from '@assistant-ui/react';
import { and, desc, eq, like } from 'drizzle-orm';
import { Bot, ImageIcon, Loader2, MessageSquare, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useLLM } from '@/hooks/useLLM';
import {
  createLLMAdapter,
  getAttachedImage,
  setAttachedImage
} from '@/lib/llm-runtime';
import { DEFAULT_THUMBNAIL_OPTIONS } from '@/lib/thumbnail';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

function CustomText() {
  return (
    <p className="whitespace-pre-line">
      <MessagePartPrimitive.Text />
      <MessagePartPrimitive.InProgress>
        <span className="ml-1 inline-flex items-center">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </span>
      </MessagePartPrimitive.InProgress>
    </p>
  );
}

interface ChatHeaderProps {
  modelDisplayName: string | undefined;
}

function ChatHeader({ modelDisplayName }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h1 className="font-bold text-2xl tracking-tight">Chat</h1>
      {modelDisplayName && (
        <span className="flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 font-medium text-green-500 text-sm">
          <Bot className="h-4 w-4" />
          {modelDisplayName}
        </span>
      )}
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-end py-2">
      <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
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

interface PhotoInfo {
  id: string;
  name: string;
  storagePath: string;
  thumbnailPath: string | null;
  objectUrl: string;
}

interface PhotoPickerProps {
  onSelect: (imageDataUrl: string) => void;
  onClose: () => void;
}

function PhotoPicker({ onSelect, onClose }: PhotoPickerProps) {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPhotos = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();
      const result = await db
        .select({
          id: files.id,
          name: files.name,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(and(like(files.mimeType, 'image/%'), eq(files.deleted, false)))
        .orderBy(desc(files.uploadDate))
        .limit(50);

      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const photosWithUrls = (
        await Promise.all(
          result.map(async (photo) => {
            try {
              const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
              const mimeType = photo.thumbnailPath
                ? 'image/jpeg'
                : 'image/jpeg';
              const data = await storage.retrieve(pathToLoad);
              const buffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(buffer).set(data);
              const blob = new Blob([buffer], { type: mimeType });
              const objectUrl = URL.createObjectURL(blob);
              return { ...photo, objectUrl };
            } catch {
              return null;
            }
          })
        )
      ).filter((p): p is PhotoInfo => p !== null);

      setPhotos(photosWithUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => {
    return () => {
      for (const p of photos) {
        URL.revokeObjectURL(p.objectUrl);
      }
    };
  }, [photos]);

  const handleSelect = useCallback(
    async (photo: PhotoInfo) => {
      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        // Load full image for sending to the model
        const data = await storage.retrieve(photo.storagePath);
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        const blob = new Blob([buffer], { type: 'image/jpeg' });

        // Convert to base64 data URL
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          onSelect(dataUrl);
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [onSelect, currentInstanceId]
  );

  const thumbnailStyle = {
    width: DEFAULT_THUMBNAIL_OPTIONS.maxWidth,
    height: DEFAULT_THUMBNAIL_OPTIONS.maxHeight
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Select a Photo</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading photos...
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
              {error}
            </div>
          )}
          {!loading && !error && photos.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No photos found. Upload images from the Files page first.
            </div>
          )}
          {!loading && !error && photos.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => handleSelect(photo)}
                  className="overflow-hidden rounded-lg border transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2"
                  style={thumbnailStyle}
                >
                  <img
                    src={photo.objectUrl}
                    alt={photo.name}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ComposerProps {
  isVisionModel: boolean;
  attachedImage: string | null;
  onAttachImage: () => void;
  onRemoveImage: () => void;
}

function Composer({
  isVisionModel,
  attachedImage,
  onAttachImage,
  onRemoveImage
}: ComposerProps) {
  return (
    <ComposerPrimitive.Root className="border-t bg-background p-4">
      {attachedImage && (
        <div className="mb-3 flex items-start gap-2">
          <div className="relative">
            <img
              src={attachedImage}
              alt="Attached"
              className="h-20 w-20 rounded-lg border object-cover"
            />
            <button
              type="button"
              onClick={onRemoveImage}
              className="absolute -top-2 -right-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow-sm hover:bg-destructive/90"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        {isVisionModel && !attachedImage && (
          <Button variant="outline" size="icon" onClick={onAttachImage}>
            <ImageIcon className="h-4 w-4" />
          </Button>
        )}
        <ComposerPrimitive.Input
          placeholder={
            isVisionModel
              ? 'Type a message... (attach an image for vision)'
              : 'Type a message...'
          }
          className="flex-1 resize-none rounded-lg border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <ComposerPrimitive.Send asChild>
          <Button size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

interface ThreadProps {
  isVisionModel: boolean;
  attachedImage: string | null;
  onAttachImage: () => void;
  onRemoveImage: () => void;
}

function Thread({
  isVisionModel,
  attachedImage,
  onAttachImage,
  onRemoveImage
}: ThreadProps) {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
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

interface ChatInterfaceProps {
  generate: ReturnType<typeof useLLM>['generate'];
  isVisionModel: boolean;
}

function ChatInterface({ generate, isVisionModel }: ChatInterfaceProps) {
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
      <div className="flex-1 overflow-hidden">
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

function NoModelLoadedContent() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-lg border bg-card p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="mt-4 font-semibold text-lg">No Model Loaded</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Load a model from the Models page to start chatting with a local LLM.
        </p>
        <Button asChild className="mt-6">
          <Link to="/models">
            <Bot className="mr-2 h-4 w-4" />
            Go to Models
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Derives a display name from an ONNX model ID.
 * Example: onnx-community/Phi-3-mini-4k-instruct -> Phi-3 Mini
 */
function getModelDisplayName(modelId: string): string {
  // Extract the model name part after the org/
  const modelName = modelId.includes('/')
    ? (modelId.split('/')[1] ?? modelId)
    : modelId;

  // Parse the name
  return modelName
    .replace(/-4k-instruct$/, '')
    .replace(/-instruct$/, '')
    .split('-')
    .slice(0, 3)
    .map((part) => {
      // Capitalize first letter of each part
      if (part.length > 0) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part;
    })
    .join(' ')
    .trim();
}

export function Chat() {
  const { loadedModel, modelType, generate } = useLLM();

  const modelDisplayName = loadedModel
    ? getModelDisplayName(loadedModel)
    : undefined;

  const isVisionModel = modelType === 'vision' || modelType === 'paligemma';

  return (
    <div className="flex h-full flex-col">
      <ChatHeader modelDisplayName={modelDisplayName} />
      {loadedModel ? (
        <ChatInterface generate={generate} isVisionModel={isVisionModel} />
      ) : (
        <NoModelLoadedContent />
      )}
    </div>
  );
}
