import {
  getHelpDocIdFromRouteSegment,
  getHelpDocLabel
} from '@help/constants/help';
import { BackLink } from '@tearleads/ui';
import { CircleHelp } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { HelpDocumentation } from '../../components/help-links/HelpDocumentation';

export function HelpDocPage() {
  const params = useParams<{ docId: string }>();
  const helpDocId = params.docId
    ? getHelpDocIdFromRouteSegment(params.docId)
    : null;

  if (!helpDocId) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-6">
        <div className="space-y-2">
          <BackLink defaultTo="/help" defaultLabel="Back to Help" />
          <div className="flex items-center gap-3">
            <CircleHelp className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Documentation</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            This documentation page was not found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="space-y-2">
        <BackLink defaultTo="/help" defaultLabel="Back to Help" />
        <div className="flex items-center gap-3">
          <CircleHelp className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">
            {getHelpDocLabel(helpDocId)}
          </h1>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <HelpDocumentation docId={helpDocId} />
      </div>
    </div>
  );
}
