import { AboutMenuItem } from '@tearleads/ui';
import vfsExplorerPackageJson from '@tearleads/vfs-explorer/package.json';

export function VfsExplorerAboutMenuItem() {
  return (
    <AboutMenuItem
      appName="VFS Explorer"
      version={vfsExplorerPackageJson.version}
    />
  );
}
