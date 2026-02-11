import mlsChatPackageJson from '@rapid/mls-chat/package.json';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

interface MlsChatWindowMenuBarProps {
  onClose: () => void;
}

export function MlsChatWindowMenuBar({ onClose }: MlsChatWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem
          appName="MLS Chat"
          version={mlsChatPackageJson.version}
          closeLabel="Close"
        />
      </DropdownMenu>
    </div>
  );
}
