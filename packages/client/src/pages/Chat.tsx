import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime
} from '@assistant-ui/react';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { Bot, MessageSquare, Send } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLLM } from '@/hooks/useLLM';
import { createWebLLMAdapter } from '@/lib/llm-runtime';

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
          <MessagePrimitive.Content />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 border-t bg-background p-4">
      <ComposerPrimitive.Input
        placeholder="Type a message..."
        className="flex-1 resize-none rounded-lg border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <ComposerPrimitive.Send asChild>
        <Button size="icon">
          <Send className="h-4 w-4" />
        </Button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4">
        <ThreadPrimitive.Empty>
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Bot className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-4">Send a message to start chatting</p>
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
      <Composer />
    </ThreadPrimitive.Root>
  );
}

interface ChatInterfaceProps {
  engine: MLCEngineInterface;
}

function ChatInterface({ engine }: ChatInterfaceProps) {
  const adapter = useMemo(() => createWebLLMAdapter(engine), [engine]);
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex-1 overflow-hidden">
        <Thread />
      </div>
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
 * Derives a display name from a MLC model ID.
 * Example: Llama-3.2-1B-Instruct-q4f16_1-MLC -> Llama 3.2 1B
 */
function getModelDisplayName(modelId: string): string {
  return modelId
    .split('-')
    .slice(0, 3)
    .join(' ')
    .replace('Instruct', '')
    .trim();
}

export function Chat() {
  const { engine, loadedModel } = useLLM();

  const modelDisplayName = loadedModel
    ? getModelDisplayName(loadedModel)
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader modelDisplayName={modelDisplayName} />
      {engine && loadedModel ? (
        <ChatInterface engine={engine} />
      ) : (
        <NoModelLoadedContent />
      )}
    </div>
  );
}
