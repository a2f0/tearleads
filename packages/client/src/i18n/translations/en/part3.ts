export const enPart3 = {
  sync: {
    // Page title
    sync: 'Sync',
    // Loading state
    loading: 'Loading...',
    // Logged in state
    loggedInAs: 'Logged in as',
    emailAddress: 'Email address',
    tokenExpires: 'Token expires',
    expired: 'Expired',
    expiresIn: 'in {{time}}',
    logout: 'Logout',
    activeSessions: 'Active Sessions',
    manageSessionsDescription: 'Manage your active sessions across devices',
    // Not logged in state
    login: 'Login',
    loginDescription: 'Sign in to sync your data across devices',
    createAccount: 'Create Account',
    createAccountDescription: 'Register to sync your data across devices',
    noAccount: "Don't have an account?",
    createOne: 'Create one',
    hasAccount: 'Already have an account?',
    signIn: 'Sign in',
    // Menu bar
    file: 'File',
    close: 'Close',
    view: 'View'
  },

  debug: {
    // Page/window titles
    debug: 'Debug',
    debugMenu: 'Debug Menu',
    // System info
    systemInfo: 'System Info',
    copyDebugInfoToClipboard: 'Copy debug info to clipboard',
    // Labels
    version: 'Version',
    environment: 'Environment',
    screen: 'Screen',
    userAgent: 'User Agent',
    platform: 'Platform',
    pixelRatio: 'Pixel Ratio',
    online: 'Online',
    language: 'Language',
    touchSupport: 'Touch Support',
    standalone: 'Standalone',
    unknown: 'Unknown',
    yes: 'Yes',
    no: 'No',
    // API status
    apiStatus: 'API Status',
    apiUrl: 'API URL',
    notSet: '(not set)',
    failedToConnectToApi: 'Failed to connect to API',
    // Actions
    actions: 'Actions',
    throwError: 'Throw Error',
    openDebugMenu: 'Open debug menu',
    closeDebugMenu: 'Close debug menu',
    closeDebugMenuButton: 'Close debug menu button',
    backToHome: 'Back to Home'
  },

  search: {
    // Search input
    search: 'Search',
    searchPlaceholder: 'Search...',
    // Filter options
    all: 'All',
    apps: 'Apps',
    helpDocs: 'Help Docs',
    contacts: 'Contacts',
    notes: 'Notes',
    emails: 'Emails',
    files: 'Files',
    playlists: 'Playlists',
    aiChats: 'AI Chats',
    // Entity type labels
    app: 'App',
    helpDoc: 'Help Doc',
    contact: 'Contact',
    note: 'Note',
    email: 'Email',
    file: 'File',
    playlist: 'Playlist',
    album: 'Album',
    aiConversation: 'AI Chat',
    // Status messages
    initializingSearch: 'Initializing search...',
    buildingSearchIndex: 'Building search index...',
    searchIndexEmpty: 'Search index is empty',
    addSomeContent: 'Add some contacts, notes, or emails to get started',
    searching: 'Searching...',
    startTypingToSearch: 'Start typing to search',
    pressEnterToList: 'Press Enter to list all objects',
    noResultsFoundFor: 'No results found for "{{query}}"',
    noResultsFound: 'No results found',
    // Results
    result: '{{count}} result',
    results: '{{count}} results',
    showingResults: 'Showing {{shown}} of {{total}} results',
    // Table headers
    title: 'Title',
    type: 'Type',
    preview: 'Preview',
    // Status bar
    itemIndexed: '{{count}} item indexed',
    itemsIndexed: '{{count}} items indexed',
    searchTook: 'Search took {{ms}} ms'
  },

  vehicles: {
    // Form labels
    make: 'Make',
    model: 'Model',
    year: 'Year',
    color: 'Color',
    vehicleForm: 'Vehicle form',
    // Buttons
    newVehicle: 'New Vehicle',
    saveVehicle: 'Save Vehicle',
    updateVehicle: 'Update Vehicle',
    edit: 'Edit',
    delete: 'Delete',
    // Table
    actions: 'Actions',
    vehiclesTable: 'Vehicles table',
    // Empty state
    loadingVehicles: 'Loading vehicles...',
    noVehiclesYet: 'No vehicles yet',
    addFirstVehicle: 'Add your first vehicle above.',
    // Errors
    unableToSaveVehicle: 'Unable to save vehicle right now. Please try again.',
    // Placeholder values
    notApplicable: 'N/A'
  }
} as const;
