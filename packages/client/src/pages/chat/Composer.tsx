import { ComposerPrimitive } from '@assistant-ui/react';
import { ImageIcon, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ComposerProps {
  isVisionModel: boolean;
  attachedImage: string | null;
  onAttachImage: () => void;
  onRemoveImage: () => void;
}

export function Composer({
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
              aria-label="Remove attached image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        {isVisionModel && !attachedImage && (
          <Button
            variant="outline"
            size="icon"
            onClick={onAttachImage}
            aria-label="Attach image"
          >
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
