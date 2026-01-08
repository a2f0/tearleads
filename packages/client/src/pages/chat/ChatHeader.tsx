import { ModelSelector } from '@/components/ModelSelector';

interface ChatHeaderProps {
  modelDisplayName: string | undefined;
}

export function ChatHeader({ modelDisplayName }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h1 className="font-bold text-2xl tracking-tight">Chat</h1>
      <ModelSelector modelDisplayName={modelDisplayName} />
    </div>
  );
}
