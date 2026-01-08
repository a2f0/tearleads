import { MessagePartPrimitive } from '@assistant-ui/react';
import { Loader2 } from 'lucide-react';

export function CustomText() {
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
