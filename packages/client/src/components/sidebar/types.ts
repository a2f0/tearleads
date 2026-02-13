import type { ComponentType } from 'react';
import type { MenuKeys } from '@/i18n';

type IconComponent = ComponentType<{ className?: string }>;

export interface NavItem {
  path: string;
  icon: IconComponent;
  labelKey: MenuKeys;
  inMobileMenu?: boolean;
  testId?: string;
}

export interface AdminFlyoutItem {
  path: string;
  icon: IconComponent;
  labelKey: MenuKeys;
}

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface SidebarContextMenuState {
  x: number;
  y: number;
  path: string;
}
