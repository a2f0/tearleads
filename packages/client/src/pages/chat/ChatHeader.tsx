import { ModelSelector } from '@/components/ModelSelector';
import { BackLink } from '@/components/ui/back-link';

interface ChatHeaderProps {
  modelDisplayName: string | undefined;
}

export function ChatHeader({ modelDisplayName }: ChatHeaderProps) {
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3">
      <BackLink defaultTo="/" defaultLabel="Back to Home" />
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Chat</h1>
        <ModelSelector modelDisplayName={modelDisplayName} />
      </div>
    </div>
  );
}
