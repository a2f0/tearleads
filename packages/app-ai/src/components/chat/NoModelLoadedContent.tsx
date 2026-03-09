import { Bot, MessageSquare } from 'lucide-react';
import { useAIUIContext } from '../../context';

export function NoModelLoadedContent() {
  const { ui, navigateToModels } = useAIUIContext();
  const { Button } = ui;

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
        {navigateToModels && (
          <Button type="button" className="mt-6" onClick={navigateToModels}>
            <Bot className="mr-2 h-4 w-4" />
            Go to Models
          </Button>
        )}
      </div>
    </div>
  );
}
