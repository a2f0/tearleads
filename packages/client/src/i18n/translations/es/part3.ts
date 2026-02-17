export const esPart3 = {
  sync: {
    // Page title
    sync: 'Sincronizar',
    // Loading state
    loading: 'Cargando...',
    // Logged in state
    loggedInAs: 'Conectado como',
    emailAddress: 'Correo electrónico',
    tokenExpires: 'El token expira',
    expired: 'Expirado',
    expiresIn: 'en {{time}}',
    logout: 'Cerrar sesión',
    activeSessions: 'Sesiones Activas',
    manageSessionsDescription:
      'Administra tus sesiones activas en todos los dispositivos',
    // Not logged in state
    login: 'Iniciar sesión',
    loginDescription:
      'Inicia sesión para sincronizar tus datos en todos los dispositivos',
    createAccount: 'Crear Cuenta',
    createAccountDescription:
      'Regístrate para sincronizar tus datos en todos los dispositivos',
    noAccount: '¿No tienes una cuenta?',
    createOne: 'Crear una',
    hasAccount: '¿Ya tienes una cuenta?',
    signIn: 'Iniciar sesión',
    // Menu bar
    file: 'Archivo',
    close: 'Cerrar',
    view: 'Ver'
  },

  debug: {
    // Page/window titles
    debug: 'Depuración',
    debugMenu: 'Menú de Depuración',
    // System info
    systemInfo: 'Información del Sistema',
    copyDebugInfoToClipboard:
      'Copiar información de depuración al portapapeles',
    // Labels
    version: 'Versión',
    environment: 'Entorno',
    screen: 'Pantalla',
    userAgent: 'User Agent',
    platform: 'Plataforma',
    pixelRatio: 'Proporción de Píxeles',
    online: 'En línea',
    language: 'Idioma',
    touchSupport: 'Soporte Táctil',
    standalone: 'Independiente',
    unknown: 'Desconocido',
    yes: 'Sí',
    no: 'No',
    // API status
    apiStatus: 'Estado de la API',
    apiUrl: 'URL de la API',
    notSet: '(no establecido)',
    failedToConnectToApi: 'Error al conectar con la API',
    // Actions
    actions: 'Acciones',
    throwError: 'Lanzar Error',
    openDebugMenu: 'Abrir menú de depuración',
    closeDebugMenu: 'Cerrar menú de depuración',
    closeDebugMenuButton: 'Botón para cerrar menú de depuración',
    backToHome: 'Volver al Inicio'
  },

  search: {
    // Search input
    search: 'Buscar',
    searchPlaceholder: 'Buscar...',
    // Filter options
    all: 'Todo',
    apps: 'Aplicaciones',
    helpDocs: 'Documentos de Ayuda',
    contacts: 'Contactos',
    notes: 'Notas',
    emails: 'Correos',
    files: 'Archivos',
    playlists: 'Listas de Reproducción',
    aiChats: 'Chats de IA',
    // Entity type labels
    app: 'Aplicación',
    helpDoc: 'Documento de Ayuda',
    contact: 'Contacto',
    note: 'Nota',
    email: 'Correo',
    file: 'Archivo',
    playlist: 'Lista de Reproducción',
    album: 'Álbum',
    aiConversation: 'Chat de IA',
    // Status messages
    initializingSearch: 'Inicializando búsqueda...',
    buildingSearchIndex: 'Construyendo índice de búsqueda...',
    searchIndexEmpty: 'El índice de búsqueda está vacío',
    addSomeContent: 'Agrega contactos, notas o correos para comenzar',
    searching: 'Buscando...',
    startTypingToSearch: 'Comienza a escribir para buscar',
    pressEnterToList: 'Presiona Enter para listar todos los objetos',
    noResultsFoundFor: 'No se encontraron resultados para "{{query}}"',
    noResultsFound: 'No se encontraron resultados',
    // Results
    result: '{{count}} resultado',
    results: '{{count}} resultados',
    showingResults: 'Mostrando {{shown}} de {{total}} resultados',
    // Table headers
    title: 'Título',
    type: 'Tipo',
    preview: 'Vista previa',
    // Status bar
    itemIndexed: '{{count}} elemento indexado',
    itemsIndexed: '{{count}} elementos indexados',
    searchTook: 'La búsqueda tardó {{ms}} ms'
  },

  vehicles: {
    // Form labels
    make: 'Marca',
    model: 'Modelo',
    year: 'Año',
    color: 'Color',
    vehicleForm: 'Formulario de vehículo',
    // Buttons
    newVehicle: 'Nuevo Vehículo',
    saveVehicle: 'Guardar Vehículo',
    updateVehicle: 'Actualizar Vehículo',
    edit: 'Editar',
    delete: 'Eliminar',
    // Table
    actions: 'Acciones',
    vehiclesTable: 'Tabla de vehículos',
    // Empty state
    loadingVehicles: 'Cargando vehículos...',
    noVehiclesYet: 'Sin vehículos aún',
    addFirstVehicle: 'Agrega tu primer vehículo arriba.',
    // Errors
    unableToSaveVehicle:
      'No se puede guardar el vehículo en este momento. Intenta de nuevo.',
    // Placeholder values
    notApplicable: 'N/A'
  }
} as const;
