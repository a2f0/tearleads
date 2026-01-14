import { describe, expect, it, vi } from 'vitest';

vi.mock('@rapid/db/sqlite', () => ({
  analyticsEvents: {},
  contactEmails: {},
  contactPhones: {},
  contacts: {},
  files: {},
  migrations: {},
  secrets: {},
  syncMetadata: {},
  userSettings: {}
}));

vi.mock('@/components/contacts/column-mapper/ColumnMapper', () => ({
  ColumnMapper: () => null
}));

vi.mock('@/components/duration-chart/DurationChart', () => ({
  DurationChart: () => null
}));

vi.mock('@/components/hud/AnalyticsTab', () => ({
  AnalyticsTab: () => null
}));
vi.mock('@/components/hud/HUD', () => ({
  HUD: () => null
}));
vi.mock('@/components/hud/HUDTrigger', () => ({
  HUDTrigger: () => null
}));
vi.mock('@/components/hud/LogsTab', () => ({
  LogsTab: () => null
}));

vi.mock('@/components/pdf/PdfViewer', () => ({
  PdfViewer: () => null
}));

vi.mock('@/components/settings/SettingsSection', () => ({
  SettingsSection: () => null
}));
vi.mock('@/components/settings/SettingsSheet', () => ({
  SettingsSheet: () => null
}));
vi.mock('@/components/settings/ThemePreview', () => ({
  ThemePreview: () => null
}));
vi.mock('@/components/settings/ThemeSelector', () => ({
  ThemeSelector: () => null
}));

vi.mock('@/components/ui/bottom-sheet/BottomSheet', () => ({
  BottomSheet: () => null,
  ANIMATION_DURATION_MS: 120
}));

vi.mock('@/pages/admin/Admin', () => ({
  Admin: () => null
}));
vi.mock('@/pages/analytics/Analytics', () => ({
  Analytics: () => null
}));
vi.mock('@/pages/cache-storage/CacheStorage', () => ({
  CacheStorage: () => null
}));
vi.mock('@/pages/chat/Chat', () => ({
  Chat: () => null
}));
vi.mock('@/pages/contacts/Contacts', () => ({
  Contacts: () => null
}));
vi.mock('@/pages/debug/Debug', () => ({
  Debug: () => null
}));
vi.mock('@/pages/keychain/Keychain', () => ({
  Keychain: () => null
}));
vi.mock('@/pages/keychain/KeychainDetail', () => ({
  KeychainDetail: () => null
}));
vi.mock('@/pages/local-storage/LocalStorage', () => ({
  LocalStorage: () => null
}));
vi.mock('@/pages/models/Models', () => ({
  Models: () => null
}));
vi.mock('@/pages/opfs/Opfs', () => ({
  Opfs: () => null
}));

import * as columnMapper from '@/components/contacts/column-mapper/index';
import * as durationChart from '@/components/duration-chart/index';
import * as hud from '@/components/hud/index';
import * as pdf from '@/components/pdf/index';
import * as settings from '@/components/settings/index';
import * as backLink from '@/components/ui/back-link/index';
import * as bottomSheet from '@/components/ui/bottom-sheet/index';
import * as card from '@/components/ui/card/index';
import * as contextMenu from '@/components/ui/context-menu/index';
import * as editableTitle from '@/components/ui/editable-title/index';
import * as gridSquare from '@/components/ui/grid-square/index';
import * as pagesAdmin from '@/pages/admin/index';
import * as pagesAnalytics from '@/pages/analytics/index';
import * as pagesCacheStorage from '@/pages/cache-storage/index';
import * as pagesChat from '@/pages/chat/index';
import * as pagesContacts from '@/pages/contacts/index';
import * as pagesDebug from '@/pages/debug/index';
import * as pagesKeychain from '@/pages/keychain/index';
import * as pagesLocalStorage from '@/pages/local-storage/index';
import * as pagesModels from '@/pages/models/index';
import * as pagesOpfs from '@/pages/opfs/index';
import * as i18n from '@/i18n/index';
import * as translations from '@/i18n/translations';
import * as schema from '@/db/schema/index';
import * as sse from '@/sse/index';
import * as video from '@/video/index';

describe('barrel exports', () => {
  it('exports components and utilities from index files', () => {
    expect(columnMapper.ColumnMapper).toBeDefined();

    expect(durationChart.CustomDot).toBeDefined();
    expect(durationChart.DurationChart).toBeDefined();
    expect(durationChart.formatDuration).toBeDefined();

    expect(hud.AnalyticsTab).toBeDefined();
    expect(hud.HUD).toBeDefined();
    expect(hud.HUDTrigger).toBeDefined();
    expect(hud.LogsTab).toBeDefined();

    expect(pdf.PdfViewer).toBeDefined();

    expect(settings.SettingsSection).toBeDefined();
    expect(settings.SettingsSheet).toBeDefined();
    expect(settings.ThemePreview).toBeDefined();
    expect(settings.ThemeSelector).toBeDefined();

    expect(backLink.BackLink).toBeDefined();
    expect(backLink.LinkWithFrom).toBeDefined();

    expect(bottomSheet.BottomSheet).toBeDefined();
    expect(bottomSheet.ANIMATION_DURATION_MS).toBeDefined();

    expect(card.Card).toBeDefined();
    expect(card.CardContent).toBeDefined();
    expect(card.CardDescription).toBeDefined();
    expect(card.CardFooter).toBeDefined();
    expect(card.CardHeader).toBeDefined();
    expect(card.CardTitle).toBeDefined();

    expect(contextMenu.ContextMenu).toBeDefined();
    expect(contextMenu.ContextMenuItem).toBeDefined();

    expect(editableTitle.EditableTitle).toBeDefined();

    expect(gridSquare.GridSquare).toBeDefined();

    expect(pagesAdmin.Admin).toBeDefined();

    expect(pagesAnalytics.Analytics).toBeDefined();
    expect(pagesAnalytics.SortIcon).toBeDefined();

    expect(pagesCacheStorage.CacheStorage).toBeDefined();

    expect(pagesChat.Chat).toBeDefined();

    expect(pagesContacts.Contacts).toBeDefined();

    expect(pagesDebug.Debug).toBeDefined();

    expect(pagesKeychain.Keychain).toBeDefined();
    expect(pagesKeychain.KeychainDetail).toBeDefined();

    expect(pagesLocalStorage.LocalStorage).toBeDefined();

    expect(pagesModels.Models).toBeDefined();

    expect(pagesOpfs.Opfs).toBeDefined();

    expect(i18n.useTranslation).toBeDefined();
    expect(i18n.useTypedTranslation).toBeDefined();
    expect(i18n.i18n).toBeDefined();
    expect(i18n.loadLanguage).toBeDefined();
    expect(i18n.supportedLanguages).toBeDefined();

    expect(translations.translations).toBeDefined();
    expect(translations.translations.ua.common.languageName.length).toBeGreaterThan(0);

    expect(schema.contacts).toBeDefined();
    expect(schema.userSettings).toBeDefined();

    expect(sse.SSEProvider).toBeDefined();
    expect(sse.useSSE).toBeDefined();
    expect(sse.useSSEContext).toBeDefined();

    expect(video.VideoProvider).toBeDefined();
    expect(video.useVideo).toBeDefined();
    expect(video.useVideoContext).toBeDefined();
  });
});
