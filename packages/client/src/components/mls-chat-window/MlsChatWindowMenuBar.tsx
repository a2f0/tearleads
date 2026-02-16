import mlsChatPackageJson from '@tearleads/mls-chat/package.json';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowMenuBar } from '@tearleads/window-manager';

interface MlsChatWindowMenuBarProps {
  onClose: () => void;
}

export function MlsChatWindowMenuBar({ onClose }: MlsChatWindowMenuBarProps) {
  return (
    <WindowMenuBar>
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
