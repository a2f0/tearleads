export interface ContactsTranslations {
  // Window titles
  contacts: string;
  newContact: string;
  // Form labels and placeholders
  firstNameRequired: string;
  lastName: string;
  birthdayPlaceholder: string;
  emailAddresses: string;
  phoneNumbers: string;
  email: string;
  phone: string;
  label: string;
  add: string;
  primary: string;
  // Detail view
  details: string;
  created: string;
  updated: string;
  // Loading states
  loadingDatabase: string;
  loadingContact: string;
  loadingContacts: string;
  // Empty states
  noContactsYet: string;
  createFirstContact: string;
  noContactInfo: string;
  // Search
  searchContacts: string;
  // Groups sidebar
  groups: string;
  newGroup: string;
  allContacts: string;
  sendEmail: string;
  rename: string;
  // Group dialogs
  groupName: string;
  cancel: string;
  create: string;
  creating: string;
  save: string;
  saving: string;
  deleteGroup: string;
  deleteGroupConfirm: string;
  deleting: string;
  renameGroup: string;
  // Import
  importCsv: string;
  done: string;
  parsingCsv: string;
  csvColumns: string;
  dragColumnHint: string;
  contactFields: string;
  dragColumnHere: string;
  previewFirstRows: string;
  totalRows: string;
  importing: string;
  importContacts: string;
  importedContacts: string;
  skipped: string;
  andMore: string;
  chooseFileHint: string;
  // Menu bar
  file: string;
  new: string;
  close: string;
  view: string;
  list: string;
  table: string;
  help: string;
  // Unlock descriptions
  thisContact: string;
  createContact: string;
  // Table headers
  name: string;
  // Import column headers
  value: string;
  // Contact detail page
  backToContacts: string;
  contactNotFound: string;
  firstNameIsRequired: string;
  emailCannotBeEmpty: string;
  phoneCannotBeEmpty: string;
  export: string;
  edit: string;
  addEmail: string;
  addPhone: string;
  emailAddress: string;
  phoneNumber: string;
}

export interface DebugTranslations {
  // Page/window titles
  debug: string;
  debugMenu: string;
  // System info
  systemInfo: string;
  copyDebugInfoToClipboard: string;
  // Labels
  version: string;
  environment: string;
  screen: string;
  userAgent: string;
  platform: string;
  pixelRatio: string;
  online: string;
  language: string;
  touchSupport: string;
  standalone: string;
  unknown: string;
  yes: string;
  no: string;
  // API status
  apiStatus: string;
  apiUrl: string;
  notSet: string;
  failedToConnectToApi: string;
  // Actions
  actions: string;
  throwError: string;
  openDebugMenu: string;
  closeDebugMenu: string;
  closeDebugMenuButton: string;
  backToHome: string;
}

export interface SearchTranslations {
  // Search input
  search: string;
  searchPlaceholder: string;
  // Filter options
  all: string;
  apps: string;
  helpDocs: string;
  contacts: string;
  notes: string;
  emails: string;
  files: string;
  playlists: string;
  aiChats: string;
  // Entity type labels
  app: string;
  helpDoc: string;
  contact: string;
  note: string;
  email: string;
  file: string;
  playlist: string;
  album: string;
  aiConversation: string;
  // Status messages
  initializingSearch: string;
  buildingSearchIndex: string;
  searchIndexEmpty: string;
  addSomeContent: string;
  searching: string;
  startTypingToSearch: string;
  pressEnterToList: string;
  noResultsFoundFor: string;
  noResultsFound: string;
  // Results
  result: string;
  results: string;
  showingResults: string;
  // Table headers
  title: string;
  type: string;
  preview: string;
  // Status bar
  itemIndexed: string;
  itemsIndexed: string;
  searchTook: string;
}

export interface VehiclesTranslations {
  // Form labels
  make: string;
  model: string;
  year: string;
  color: string;
  vehicleForm: string;
  // Buttons
  newVehicle: string;
  saveVehicle: string;
  updateVehicle: string;
  edit: string;
  delete: string;
  // Table
  actions: string;
  vehiclesTable: string;
  // Empty state
  loadingVehicles: string;
  noVehiclesYet: string;
  addFirstVehicle: string;
  // Errors
  unableToSaveVehicle: string;
  // Placeholder values
  notApplicable: string;
}

export interface SyncTranslations {
  // Page title
  sync: string;
  // Loading state
  loading: string;
  // Logged in state
  loggedInAs: string;
  emailAddress: string;
  tokenExpires: string;
  expired: string;
  expiresIn: string;
  logout: string;
  activeSessions: string;
  manageSessionsDescription: string;
  // Not logged in state
  login: string;
  loginDescription: string;
  createAccount: string;
  createAccountDescription: string;
  noAccount: string;
  createOne: string;
  hasAccount: string;
  signIn: string;
  // Menu bar
  file: string;
  close: string;
  view: string;
}

export interface AdminTranslations {
  // Page titles and headers
  admin: string;
  redisAdmin: string;
  redisBrowser: string;
  postgresAdmin: string;
  databaseManager: string;
  usersAdmin: string;
  aiRequestsAdmin: string;
  groupsAdmin: string;
  organizationsAdmin: string;
  // Page descriptions
  manageUserAccessAndProfiles: string;
  requestIdsAndTokenUsage: string;
  createGroupToOrganizeUsers: string;
  createOrganizationToManageAccess: string;
  // Common actions
  backToAdmin: string;
  backToUsers: string;
  backToUsersAdmin: string;
  backToGroups: string;
  backToOrganizations: string;
  backToOrganization: string;
  backToHome: string;
  retry: string;
  save: string;
  cancel: string;
  create: string;
  delete: string;
  edit: string;
  add: string;
  remove: string;
  reset: string;
  refresh: string;
  copyId: string;
  loadMore: string;
  // Loading states
  loading: string;
  loadingMore: string;
  loadingUsers: string;
  loadingUser: string;
  loadingGroups: string;
  loadingRedisKeys: string;
  loadingTableData: string;
  loadingAiRequestUsage: string;
  loadingValue: string;
  loadingConnectionInfo: string;
  // Empty states
  noKeysFound: string;
  noUsersFound: string;
  noGroupsYet: string;
  noOrganizationsYet: string;
  noMembersYet: string;
  noGroupsAvailable: string;
  noUsersInOrganization: string;
  noGroupsInOrganization: string;
  noRowsFound: string;
  noTablesFound: string;
  noAiUsageRequestsFound: string;
  noTableSelected: string;
  // Table headers
  name: string;
  description: string;
  members: string;
  userId: string;
  email: string;
  created: string;
  updated: string;
  lastActive: string;
  confirmed: string;
  tokens: string;
  requests: string;
  lastUsage: string;
  usageId: string;
  openRouterRequestId: string;
  model: string;
  prompt: string;
  completion: string;
  total: string;
  table: string;
  tableView: string;
  documentView: string;
  size: string;
  rows: string;
  field: string;
  value: string;
  key: string;
  type: string;
  ttl: string;
  id: string;
  host: string;
  port: string;
  database: string;
  user: string;
  // Form labels
  filterByUserId: string;
  organizationScope: string;
  allOrganizations: string;
  organizationId: string;
  organizationIds: string;
  organizationName: string;
  descriptionOptional: string;
  emailConfirmed: string;
  separateOrganizationIds: string;
  enterGroupName: string;
  enterGroupDescription: string;
  enterOrganizationName: string;
  enterOrganizationDescription: string;
  enterOrganizationId: string;
  enterUserId: string;
  selectOrganization: string;
  emailIsRequired: string;
  nameIsRequired: string;
  organizationIdIsRequired: string;
  // Dialogs
  createGroup: string;
  createGroupDescription: string;
  createOrganization: string;
  createOrganizationDescription: string;
  editGroup: string;
  editUser: string;
  deleteGroup: string;
  deleteGroupConfirm: string;
  deleteOrganization: string;
  deleteOrganizationConfirm: string;
  deleteRedisKey: string;
  deleteRedisKeyConfirm: string;
  deleting: string;
  removeMember: string;
  removeMemberConfirm: string;
  removeFromGroup: string;
  removeFromGroupConfirm: string;
  // Status
  yes: string;
  no: string;
  member: string;
  membersCount: string;
  notAMember: string;
  memberSince: string;
  joined: string;
  noExpiry: string;
  keyNotFound: string;
  connected: string;
  unavailable: string;
  // Sections
  details: string;
  aiUsage: string;
  aiRequests: string;
  viewRequests: string;
  groups: string;
  users: string;
  // User detail
  copyUserIdToClipboard: string;
  copyOrganizationIdToClipboard: string;
  totalTokens: string;
  promptTokens: string;
  completionTokens: string;
  // Postgres
  tableBrowser: string;
  exportAsCsv: string;
  columnSettings: string;
  visibleColumns: string;
  tableSummary: string;
  totalDatabase: string;
  connection: string;
  // Redis
  valueDisplayNotSupported: string;
  // Menu bar
  file: string;
  close: string;
  view: string;
  // Admin options
  redis: string;
  postgres: string;
  compliance: string;
  organizations: string;
  // Error messages
  failedToFetchValue: string;
  failedToExportCsv: string;
  groupWithNameExists: string;
  organizationWithNameExists: string;
  userAlreadyMember: string;
  userNotFound: string;
  groupNotFound: string;
  organizationNotFound: string;
  groupOrUserNotFound: string;
  failedToAddUserToGroup: string;
  failedToRemoveUserFromGroup: string;
  failedToLoadGroups: string;
  failedToLoadSomeGroupMemberships: string;
  organizationIdCopied: string;
  failedToCopyOrganizationId: string;
}

export interface HealthExerciseNames {
  'ex_a1b2c3d4-1001-4000-8000-000000000001': string; // Back Squat
  'ex_a1b2c3d4-1002-4000-8000-000000000002': string; // Bench Press
  'ex_a1b2c3d4-1003-4000-8000-000000000003': string; // Deadlift
  'ex_a1b2c3d4-1004-4000-8000-000000000004': string; // Overhead Press
  'ex_a1b2c3d4-1005-4000-8000-000000000005': string; // Barbell Row
  'ex_a1b2c3d4-1006-4000-8000-000000000006': string; // Pull-Up
  'ex_a1b2c3d4-1007-4000-8000-000000000007': string; // Strict Pull-Up
  'ex_a1b2c3d4-1008-4000-8000-000000000008': string; // Chin-Up
  'ex_a1b2c3d4-1009-4000-8000-000000000009': string; // Wide Grip Pull-Up
  'ex_a1b2c3d4-1010-4000-8000-000000000010': string; // Neutral Grip Pull-Up
  'ex_a1b2c3d4-1011-4000-8000-000000000011': string; // Weighted Pull-Up
  'ex_a1b2c3d4-1012-4000-8000-000000000012': string; // L-Sit Pull-Up
  'ex_a1b2c3d4-1013-4000-8000-000000000013': string; // Archer Pull-Up
  'ex_a1b2c3d4-1014-4000-8000-000000000014': string; // Commando Pull-Up
  'ex_a1b2c3d4-1015-4000-8000-000000000015': string; // Kipping Pull-Up
  'ex_a1b2c3d4-1016-4000-8000-000000000016': string; // Towel Pull-Up
  'ex_a1b2c3d4-1017-4000-8000-000000000017': string; // Mixed Grip Pull-Up
  'ex_a1b2c3d4-1018-4000-8000-000000000018': string; // Eccentric Pull-Up
  'ex_a1b2c3d4-1019-4000-8000-000000000019': string; // Around-the-World Pull-Up
  'ex_a1b2c3d4-1020-4000-8000-000000000020': string; // Chest-to-Bar Pull-Up
  'ex_a1b2c3d4-1021-4000-8000-000000000021': string; // One-Arm Pull-Up (Assisted)
  'ex_a1b2c3d4-1022-4000-8000-000000000022': string; // Push-Up
  'ex_a1b2c3d4-1023-4000-8000-000000000023': string; // Strict Push-Up
  'ex_a1b2c3d4-1024-4000-8000-000000000024': string; // Wide Push-Up
  'ex_a1b2c3d4-1025-4000-8000-000000000025': string; // Narrow Push-Up
  'ex_a1b2c3d4-1026-4000-8000-000000000026': string; // Diamond Push-Up
  'ex_a1b2c3d4-1027-4000-8000-000000000027': string; // Weighted Push-Up
  'ex_a1b2c3d4-1028-4000-8000-000000000028': string; // Decline Push-Up
  'ex_a1b2c3d4-1029-4000-8000-000000000029': string; // Incline Push-Up
  'ex_a1b2c3d4-1030-4000-8000-000000000030': string; // Archer Push-Up
  'ex_a1b2c3d4-1031-4000-8000-000000000031': string; // Clapping Push-Up
  'ex_a1b2c3d4-1032-4000-8000-000000000032': string; // Pike Push-Up
  'ex_a1b2c3d4-1033-4000-8000-000000000033': string; // Spiderman Push-Up
  'ex_a1b2c3d4-1034-4000-8000-000000000034': string; // One-Arm Push-Up
  'ex_a1b2c3d4-1035-4000-8000-000000000035': string; // Eccentric Push-Up
  'ex_a1b2c3d4-1036-4000-8000-000000000036': string; // Knuckle Push-Up
  'ex_a1b2c3d4-1037-4000-8000-000000000037': string; // Hindu Push-Up
}

export interface HealthTranslations {
  exercises: string;
  workouts: string;
  weight: string;
  bloodPressure: string;
  noExercisesFound: string;
  variation_one: string;
  variation_other: string;
  exerciseName: string;
  category: string;
  addExercise: string;
  exerciseNames: HealthExerciseNames;
}
