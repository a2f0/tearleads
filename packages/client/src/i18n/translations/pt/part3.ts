export const ptPart3 = {
  sync: {
    // Page title
    sync: 'Sincronizar',
    // Loading state
    loading: 'Carregando...',
    // Logged in state
    loggedInAs: 'Conectado como',
    emailAddress: 'Endereço de e-mail',
    tokenExpires: 'Token expira',
    expired: 'Expirado',
    expiresIn: 'em {{time}}',
    logout: 'Sair',
    activeSessions: 'Sessões Ativas',
    manageSessionsDescription:
      'Gerencie suas sessões ativas em todos os dispositivos',
    // Not logged in state
    login: 'Entrar',
    loginDescription:
      'Entre para sincronizar seus dados em todos os dispositivos',
    createAccount: 'Criar Conta',
    createAccountDescription:
      'Registre-se para sincronizar seus dados em todos os dispositivos',
    noAccount: 'Não tem uma conta?',
    createOne: 'Criar uma',
    hasAccount: 'Já tem uma conta?',
    signIn: 'Entrar',
    // Menu bar
    file: 'Arquivo',
    close: 'Fechar',
    view: 'Visualizar'
  },

  debug: {
    // Page/window titles
    debug: 'Depuração',
    debugMenu: 'Menu de Depuração',
    // System info
    systemInfo: 'Informações do Sistema',
    copyDebugInfoToClipboard:
      'Copiar informações de depuração para área de transferência',
    // Labels
    version: 'Versão',
    environment: 'Ambiente',
    screen: 'Tela',
    userAgent: 'User Agent',
    platform: 'Plataforma',
    pixelRatio: 'Proporção de Pixels',
    online: 'Online',
    language: 'Idioma',
    touchSupport: 'Suporte a Toque',
    standalone: 'Autônomo',
    unknown: 'Desconhecido',
    yes: 'Sim',
    no: 'Não',
    // API status
    apiStatus: 'Status da API',
    apiUrl: 'URL da API',
    notSet: '(não definido)',
    failedToConnectToApi: 'Falha ao conectar com a API',
    // Actions
    actions: 'Ações',
    throwError: 'Lançar Erro',
    openDebugMenu: 'Abrir menu de depuração',
    closeDebugMenu: 'Fechar menu de depuração',
    closeDebugMenuButton: 'Botão para fechar menu de depuração',
    backToHome: 'Voltar para o Início'
  },

  search: {
    // Search input
    search: 'Buscar',
    searchPlaceholder: 'Buscar...',
    // Filter options
    all: 'Tudo',
    apps: 'Aplicativos',
    helpDocs: 'Documentos de Ajuda',
    contacts: 'Contatos',
    notes: 'Notas',
    emails: 'E-mails',
    files: 'Arquivos',
    playlists: 'Playlists',
    aiChats: 'Chats de IA',
    // Entity type labels
    app: 'Aplicativo',
    helpDoc: 'Documento de Ajuda',
    contact: 'Contato',
    note: 'Nota',
    email: 'E-mail',
    file: 'Arquivo',
    playlist: 'Playlist',
    album: 'Álbum',
    aiConversation: 'Chat de IA',
    // Status messages
    initializingSearch: 'Inicializando busca...',
    buildingSearchIndex: 'Construindo índice de busca...',
    searchIndexEmpty: 'O índice de busca está vazio',
    addSomeContent: 'Adicione contatos, notas ou e-mails para começar',
    searching: 'Buscando...',
    startTypingToSearch: 'Comece a digitar para buscar',
    pressEnterToList: 'Pressione Enter para listar todos os objetos',
    noResultsFoundFor: 'Nenhum resultado encontrado para "{{query}}"',
    noResultsFound: 'Nenhum resultado encontrado',
    // Results
    result: '{{count}} resultado',
    results: '{{count}} resultados',
    showingResults: 'Mostrando {{shown}} de {{total}} resultados',
    // Table headers
    title: 'Título',
    type: 'Tipo',
    preview: 'Visualização',
    // Status bar
    itemIndexed: '{{count}} item indexado',
    itemsIndexed: '{{count}} itens indexados',
    searchTook: 'Busca levou {{ms}} ms'
  },

  vehicles: {
    // Form labels
    make: 'Marca',
    model: 'Modelo',
    year: 'Ano',
    color: 'Cor',
    vehicleForm: 'Formulário de veículo',
    // Buttons
    newVehicle: 'Novo Veículo',
    saveVehicle: 'Salvar Veículo',
    updateVehicle: 'Atualizar Veículo',
    edit: 'Editar',
    delete: 'Excluir',
    // Table
    actions: 'Ações',
    vehiclesTable: 'Tabela de veículos',
    // Empty state
    loadingVehicles: 'Carregando veículos...',
    noVehiclesYet: 'Sem veículos ainda',
    addFirstVehicle: 'Adicione seu primeiro veículo acima.',
    // Errors
    unableToSaveVehicle:
      'Não foi possível salvar o veículo agora. Tente novamente.',
    // Placeholder values
    notApplicable: 'N/A'
  }
} as const;
