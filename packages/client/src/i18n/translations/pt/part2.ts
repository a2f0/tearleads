export const ptPart2 = {
  settings: {
    font: 'Fonte',
    fontDescription: 'Escolha seu estilo de fonte preferido',
    fontSystem: 'Sistema',
    fontMonospace: 'Monoespaçada',
    iconDepth: 'Profundidade dos ícones',
    iconDepthDescription:
      'Escolha se os ícones parecem em relevo ou rebaixados',
    iconDepthEmbossed: 'Em relevo',
    iconDepthDebossed: 'Rebaixados',
    iconBackground: 'Fundos de ícone',
    iconBackgroundDescription:
      'Escolha se os ícones têm fundo colorido ou transparente',
    iconBackgroundColored: 'Colorido',
    iconBackgroundTransparent: 'Transparente',
    tooltips: 'Dicas',
    tooltipsDescription:
      'Mostrar dicas úteis ao passar o cursor sobre os elementos',
    tooltipsEnabled: 'Ativado',
    tooltipsDisabled: 'Desativado',
    windowOpacity: 'Opacidade das janelas',
    windowOpacityDescription:
      'Escolha se as janelas flutuantes são translúcidas ou totalmente opacas',
    windowOpacityTranslucent: 'Translúcido',
    windowOpacityOpaque: 'Opaco',
    borderRadius: 'Raio da borda',
    borderRadiusDescription:
      'Escolha se a interface e as janelas usam cantos arredondados ou retos',
    borderRadiusRounded: 'Arredondado',
    borderRadiusSquare: 'Reto'
  },

  classic: {
    // TagSidebar
    tagsSidebar: 'Barra lateral de tags',
    tagListContextMenu:
      'Lista de tags, pressione Shift+F10 para o menu de contexto',
    allItems: 'Todos os itens',
    virtualTags: 'Tags virtuais',
    deletedTags: 'Tags excluidas',
    tagList: 'Lista de tags',
    searchTags: 'Buscar tags',
    dragTag: 'Arrastar tag',
    save: 'Salvar',
    cancel: 'Cancelar',
    saveTagName: 'Salvar nome da tag',
    cancelEditing: 'Cancelar edicao',
    restore: 'Restaurar',
    restoreTag: 'Restaurar tag',
    edit: 'Editar',
    editTag: 'Editar tag',
    moveUp: 'Mover para cima',
    moveUpTag: 'Mover tag',
    moveDown: 'Mover para baixo',
    moveDownTag: 'Mover tag',
    delete: 'Excluir',
    deleteTag: 'Excluir tag',
    // NotesPane
    notesPane: 'Painel de notas',
    entryListContextMenu:
      'Lista de entradas, pressione Shift+F10 para o menu de contexto',
    noteList: 'Lista de notas',
    searchEntries: 'Buscar entradas',
    dragEntry: 'Arrastar entrada',
    editEntryTitle: 'Editar titulo da entrada',
    editEntryBody: 'Editar corpo da entrada',
    saveEntry: 'Salvar entrada',
    editNote: 'Editar nota',
    moveUpNote: 'Mover nota',
    moveDownNote: 'Mover nota',
    // ClassicMenuBar
    sortTags: 'Ordenar tags',
    sortEntries: 'Ordenar entradas',
    tags: 'Tags',
    entries: 'Entradas',
    // ClassicContextMenu
    closeContextMenu: 'Fechar menu de contexto',
    // ClassicWindowMenuBar
    file: 'Arquivo',
    newEntry: 'Nova Entrada',
    close: 'Fechar',
    undo: 'Desfazer',
    redo: 'Refazer',
    newTag: 'Nova Tag',
    sortBy: 'Ordenar por',
    view: 'Visualizar',
    help: 'Ajuda',
    classic: 'Clássico'
  },

  contacts: {
    // Window titles
    contacts: 'Contatos',
    newContact: 'Novo Contato',
    // Form labels and placeholders
    firstNameRequired: 'Nome *',
    lastName: 'Sobrenome',
    birthdayPlaceholder: 'Aniversário (AAAA-MM-DD)',
    emailAddresses: 'Endereços de E-mail',
    phoneNumbers: 'Números de Telefone',
    email: 'E-mail',
    phone: 'Telefone',
    label: 'Rótulo',
    add: 'Adicionar',
    primary: 'Principal',
    // Detail view
    details: 'Detalhes',
    created: 'Criado',
    updated: 'Atualizado',
    // Loading states
    loadingDatabase: 'Carregando banco de dados...',
    loadingContact: 'Carregando contato...',
    loadingContacts: 'Carregando contatos...',
    // Empty states
    noContactsYet: 'Sem contatos ainda',
    createFirstContact: 'Crie seu primeiro contato',
    noContactInfo: 'Sem informações de contato',
    // Search
    searchContacts: 'Buscar contatos...',
    // Groups sidebar
    groups: 'Grupos',
    newGroup: 'Novo Grupo',
    allContacts: 'Todos os Contatos',
    sendEmail: 'Enviar e-mail',
    rename: 'Renomear',
    // Group dialogs
    groupName: 'Nome do grupo',
    cancel: 'Cancelar',
    create: 'Criar',
    creating: 'Criando...',
    save: 'Salvar',
    saving: 'Salvando...',
    deleteGroup: 'Excluir Grupo',
    deleteGroupConfirm:
      'Excluir "{{name}}"? Os contatos serão mantidos, mas removidos deste grupo.',
    deleting: 'Excluindo...',
    renameGroup: 'Renomear Grupo',
    // Import
    importCsv: 'Importar CSV',
    done: 'Concluído',
    parsingCsv: 'Analisando CSV...',
    csvColumns: 'Colunas do CSV',
    dragColumnHint: 'Arraste as colunas para mapeá-las aos campos de contato',
    contactFields: 'Campos do Contato',
    dragColumnHere: 'Arraste uma coluna aqui',
    previewFirstRows: 'Visualização (primeiras 3 linhas)',
    totalRows: '{{count}} linhas no total',
    importing: 'Importando... {{progress}}%',
    importContacts: 'Importar {{count}} Contatos',
    importedContacts:
      'Importado{{plural}} {{imported}} contato{{plural}}{{skippedText}}',
    skipped: ', ignorados {{count}}',
    andMore: '...e mais {{count}}',
    chooseFileHint:
      'Selecione Arquivo > Importar CSV para escolher um arquivo.',
    // Menu bar
    file: 'Arquivo',
    new: 'Novo',
    close: 'Fechar',
    view: 'Visualizar',
    list: 'Lista',
    table: 'Tabela',
    help: 'Ajuda',
    // Unlock descriptions
    thisContact: 'este contato',
    createContact: 'criar um contato',
    // Table headers
    name: 'Nome',
    // Import column headers
    value: 'Valor',
    // Contact detail page
    backToContacts: 'Voltar para Contatos',
    contactNotFound: 'Contato não encontrado',
    firstNameIsRequired: 'Nome é obrigatório',
    emailCannotBeEmpty: 'Endereço de e-mail não pode estar vazio',
    phoneCannotBeEmpty: 'Número de telefone não pode estar vazio',
    export: 'Exportar',
    edit: 'Editar',
    addEmail: 'Adicionar E-mail',
    addPhone: 'Adicionar Telefone',
    emailAddress: 'Endereço de e-mail',
    phoneNumber: 'Número de telefone'
  }
} as const;
