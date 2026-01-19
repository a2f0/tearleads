import { Bot, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface NoModelLoadedContentProps {
  onOpenModels?: () => void;
}

export function NoModelLoadedContent({
  onOpenModels
}: NoModelLoadedContentProps) {
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
        {onOpenModels ? (
          <Button type="button" className="mt-6" onClick={onOpenModels}>
            <Bot className="mr-2 h-4 w-4" />
            Go to Models
          </Button>
        ) : (
          <Button asChild className="mt-6">
            <Link to="/models">
              <Bot className="mr-2 h-4 w-4" />
              Go to Models
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
