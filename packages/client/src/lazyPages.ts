import { lazy } from 'react';

export const Admin = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.Admin }))
);
export const AdminLauncher = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.AdminLauncher }))
);
export const AiRequestsAdminPage = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.AiRequestsAdminPage }))
);
export const PostgresAdmin = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.PostgresAdmin }))
);
export const GroupsAdminPage = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.GroupsAdminPage }))
);
export const GroupDetailPageRoute = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.GroupDetailPageRoute }))
);
export const OrganizationsAdminPage = lazy(() =>
  import('./pages/admin').then((m) => ({
    default: m.OrganizationsAdminPage
  }))
);
export const OrganizationDetailPageRoute = lazy(() =>
  import('./pages/admin').then((m) => ({
    default: m.OrganizationDetailPageRoute
  }))
);
export const UsersAdminPage = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.UsersAdminPage }))
);
export const UsersAdminDetail = lazy(() =>
  import('./pages/admin').then((m) => ({ default: m.UsersAdminDetail }))
);
export const Analytics = lazy(() =>
  import('./pages/analytics').then((m) => ({ default: m.Analytics }))
);
export const AudioDetail = lazy(() =>
  import('./pages/AudioDetail').then((m) => ({ default: m.AudioDetail }))
);
export const AudioPage = lazy(() =>
  import('./pages/Audio').then((m) => ({ default: m.Audio }))
);
export const Backups = lazy(() =>
  import('./pages/Backups').then((m) => ({ default: m.Backups }))
);
export const Classic = lazy(() =>
  import('./pages/Classic').then((m) => ({ default: m.Classic }))
);
export const CacheStorage = lazy(() =>
  import('./pages/cache-storage').then((m) => ({ default: m.CacheStorage }))
);
export const Calendar = lazy(() =>
  import('./pages/Calendar').then((m) => ({ default: m.Calendar }))
);
export const CameraPage = lazy(() =>
  import('./pages/Camera').then((m) => ({ default: m.Camera }))
);
export const Businesses = lazy(() =>
  import('./pages/Businesses').then((m) => ({ default: m.Businesses }))
);
export const Vehicles = lazy(() =>
  import('./pages/Vehicles').then((m) => ({ default: m.Vehicles }))
);
export const Chat = lazy(() =>
  import('./pages/chat').then((m) => ({ default: m.Chat }))
);
export const ContactDetail = lazy(() =>
  import('./pages/ContactDetail').then((m) => ({ default: m.ContactDetail }))
);
export const Console = lazy(() =>
  import('./pages/console').then((m) => ({ default: m.Console }))
);
export const ContactNew = lazy(() =>
  import('./pages/ContactNew').then((m) => ({ default: m.ContactNew }))
);
export const Contacts = lazy(() =>
  import('./pages/contacts').then((m) => ({ default: m.Contacts }))
);
export const DebugBrowserLauncher = lazy(() =>
  import('./pages/debug').then((m) => ({ default: m.DebugBrowserLauncher }))
);
export const DebugLauncher = lazy(() =>
  import('./pages/debug').then((m) => ({ default: m.DebugLauncher }))
);
export const DebugSystemInfo = lazy(() =>
  import('./pages/debug').then((m) => ({ default: m.Debug }))
);
export const ApiDocsPage = lazy(() =>
  import('./pages/help/ApiDocs').then((m) => ({ default: m.ApiDocsPage }))
);
export const HelpDocPage = lazy(() =>
  import('./pages/help/HelpDoc').then((m) => ({ default: m.HelpDocPage }))
);
export const Help = lazy(() =>
  import('./pages/help/Help').then((m) => ({ default: m.Help }))
);
export const Compliance = lazy(() =>
  import('./pages/compliance/Compliance').then((m) => ({
    default: m.Compliance
  }))
);
export const ComplianceDocPage = lazy(() =>
  import('./pages/compliance/ComplianceDoc').then((m) => ({
    default: m.ComplianceDocPage
  }))
);
export const DocumentDetail = lazy(() =>
  import('./pages/DocumentDetail').then((m) => ({ default: m.DocumentDetail }))
);
export const Documents = lazy(() =>
  import('./pages/Documents').then((m) => ({ default: m.Documents }))
);
export const Email = lazy(() =>
  import('./pages/Email').then((m) => ({ default: m.Email }))
);
export const MlsChat = lazy(() =>
  import('./pages/MlsChat').then((m) => ({ default: m.MlsChat }))
);
export const Files = lazy(() =>
  import('./pages/Files').then((m) => ({ default: m.Files }))
);
export const Home = lazy(() =>
  import('./pages/Home').then((m) => ({ default: m.Home }))
);
export const Health = lazy(() =>
  import('./pages/Health').then((m) => ({ default: m.Health }))
);
export const Keychain = lazy(() =>
  import('./pages/keychain').then((m) => ({ default: m.Keychain }))
);
export const KeychainDetail = lazy(() =>
  import('./pages/keychain').then((m) => ({ default: m.KeychainDetail }))
);
export const Wallet = lazy(() =>
  import('./pages/wallet').then((m) => ({ default: m.Wallet }))
);
export const WalletDetail = lazy(() =>
  import('./pages/wallet').then((m) => ({ default: m.WalletDetail }))
);
export const WalletNewItem = lazy(() =>
  import('./pages/wallet').then((m) => ({ default: m.WalletNewItem }))
);
export const Licenses = lazy(() =>
  import('./pages/Licenses').then((m) => ({ default: m.Licenses }))
);
export const LocalStorage = lazy(() =>
  import('./pages/local-storage').then((m) => ({ default: m.LocalStorage }))
);
export const Models = lazy(() =>
  import('./pages/models').then((m) => ({ default: m.Models }))
);
export const NoteDetail = lazy(() =>
  import('./pages/NoteDetail').then((m) => ({ default: m.NoteDetail }))
);
export const Notes = lazy(() =>
  import('./pages/Notes').then((m) => ({ default: m.Notes }))
);
export const Opfs = lazy(() =>
  import('./pages/opfs').then((m) => ({ default: m.Opfs }))
);
export const PhotoDetail = lazy(() =>
  import('./pages/PhotoDetail').then((m) => ({ default: m.PhotoDetail }))
);
export const Photos = lazy(() =>
  import('./pages/photos-components').then((m) => ({ default: m.PhotosPage }))
);
export const Search = lazy(() =>
  import('./pages/search').then((m) => ({ default: m.Search }))
);
export const Settings = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.Settings }))
);
export const Sync = lazy(() =>
  import('./pages/sync').then((m) => ({ default: m.Sync }))
);
export const Sqlite = lazy(() =>
  import('./pages/Sqlite').then((m) => ({ default: m.Sqlite }))
);
export const TableRows = lazy(() =>
  import('./pages/TableRows').then((m) => ({ default: m.TableRows }))
);
export const Tables = lazy(() =>
  import('./pages/Tables').then((m) => ({ default: m.Tables }))
);
export const VideoDetail = lazy(() =>
  import('./pages/VideoDetail').then((m) => ({ default: m.VideoDetail }))
);
export const Vfs = lazy(() =>
  import('./pages/Vfs').then((m) => ({ default: m.Vfs }))
);
export const VideoPage = lazy(() =>
  import('./pages/Video').then((m) => ({ default: m.Video }))
);
