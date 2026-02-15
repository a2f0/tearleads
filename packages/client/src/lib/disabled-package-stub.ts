/**
 * Stub module for disabled packages.
 * When a feature is disabled, its package is aliased to this module.
 * This enables tree-shaking to remove the package code from the bundle.
 *
 * Exports placeholder values for all commonly imported names from
 * feature packages. Components render nothing, hooks return empty objects,
 * and functions are no-ops.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// biome-ignore lint/suspicious/noExplicitAny: Stub needs to accept any return type
const noop = (): any => undefined;

// biome-ignore lint/suspicious/noExplicitAny: Stub needs to return any hook shape
const useStub = (): any => ({});

// Component stub that renders nothing
const ComponentStub = (): null => null;

// Constant stubs
const EMPTY_STRING = '';
// biome-ignore lint/suspicious/noExplicitAny: Stub needs to accept any property
const EMPTY_OBJECT: Record<string, any> = {};

export default EMPTY_OBJECT;

// ============================================
// @tearleads/audio exports
// ============================================
export const useAudioContext = useStub;
export const useAudio = useStub;
export const useAudioAnalyser = useStub;
export const useMultiFileUpload = useStub;
export const AudioUIProvider = ComponentStub;
export const AudioPlaylistsSidebar = ComponentStub;
export const AudioWindow = ComponentStub;
export const ALL_AUDIO_ID = EMPTY_STRING;

// ============================================
// @tearleads/admin exports
// ============================================
export const Admin = ComponentStub;
export const AdminUsersWindow = ComponentStub;
export const AdminUsersWindowView = ComponentStub;
export const AdminGroupsWindow = ComponentStub;
export const AdminGroupsWindowView = ComponentStub;
export const AdminOrganizationsWindow = ComponentStub;
export const AdminOrganizationsWindowView = ComponentStub;
export const AdminRedisWindow = ComponentStub;
export const AdminPostgresWindow = ComponentStub;
export const AdminRedisWindowContent = ComponentStub;
export const AdminPostgresWindowContent = ComponentStub;
export const AdminPostgres = ComponentStub;
export const AdminRedis = ComponentStub;
export const AdminGroups = ComponentStub;

// ============================================
// @tearleads/calendar exports
// ============================================
export const Calendar = ComponentStub;
export const CalendarWindow = ComponentStub;
export const CalendarWindowMenuBar = ComponentStub;
export const CalendarContent = ComponentStub;
export const CalendarEventForm = ComponentStub;
export const useCalendarStore = useStub;
export const CALENDAR_CREATE_EVENT = 'calendar:create';
export const CALENDAR_CREATE_ITEM_EVENT = 'calendar:create-item';
export const CALENDAR_CREATE_SUBMIT_EVENT = 'calendar:create-submit';
export type CalendarView = 'month' | 'week' | 'day';

// ============================================
// @tearleads/contacts exports
// ============================================
export const Contacts = ComponentStub;
export const ContactsWindow = ComponentStub;
export const ContactsGroupsSidebar = ComponentStub;
export const useContactsUIActions = useStub;
export const useContactsUIState = useStub;
export const ALL_CONTACTS_ID = EMPTY_STRING;

// ============================================
// @tearleads/email exports
// ============================================
export const Email = ComponentStub;
export const EmailWindow = ComponentStub;
export const useEmailUIActions = useStub;
export const useEmailUIState = useStub;
export const useEmailDraftActions = useStub;
export const useEmailDraftState = useStub;

// ============================================
// @tearleads/health exports
// ============================================
export const Health = ComponentStub;
export const createHealthTracker = noop;
export const isDefaultExercise = noop;

// ============================================
// @tearleads/mls-chat exports
// ============================================
export const MlsChat = ComponentStub;
export const MlsChatWindow = ComponentStub;
export const MlsChatUI = ComponentStub;
export const MlsChatGroupList = ComponentStub;
export const MlsChatContent = ComponentStub;
export const useMlsChatStore = useStub;
export const useMlsEngine = useStub;
export const useMlsGroupActions = useStub;

// ============================================
// @tearleads/sync exports
// ============================================
export const Sync = ComponentStub;
export const SyncWindow = ComponentStub;

// ============================================
// @tearleads/terminal exports
// ============================================
export const Terminal = ComponentStub;
export const TerminalUI = ComponentStub;
export const useTerminalHistory = useStub;
export const useTerminalCommands = useStub;

// ============================================
// @tearleads/vehicles exports
// ============================================
export const Vehicles = ComponentStub;
export const normalizeVehicleProfile = noop;

// ============================================
// @tearleads/wallet exports
// ============================================
export const Wallet = ComponentStub;
export const WalletWindow = ComponentStub;
export const WalletDetail = ComponentStub;
export const WalletNewItem = ComponentStub;

// ============================================
// @tearleads/camera exports
// ============================================
export const Camera = ComponentStub;
export const CameraWindow = ComponentStub;
export const CameraCapture = ComponentStub;

// ============================================
// @tearleads/classic exports
// ============================================
export const Classic = ComponentStub;
export const ClassicWorkspace = ComponentStub;
export const useClassicStore = useStub;
export const useClassicActions = useStub;
export const createClassicEntryTree = noop;
export const createClassicTagTree = noop;
export const createClassicNote = noop;
export const createClassicTag = noop;
export const CLASSIC_CREATE_NOTE_EVENT = 'classic:create-note';
export const CLASSIC_CREATE_TAG_EVENT = 'classic:create-tag';

// ============================================
// @tearleads/compliance exports
// ============================================
export const Compliance = ComponentStub;
export const ComplianceDocPage = ComponentStub;

// ============================================
// @tearleads/businesses exports
// ============================================
export const Businesses = ComponentStub;
export const normalizeBusinessIdentifiers = noop;

// ============================================
// @tearleads/analytics exports
// ============================================
export const Analytics = ComponentStub;

// ============================================
// @tearleads/notes exports (should NOT be stubbed for notepad)
// ============================================
export const Notes = ComponentStub;
