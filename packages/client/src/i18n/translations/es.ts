import type { I18NextTranslations } from './types';

export const es = {
  common: {
    language: 'Idioma',
    languageName: 'Español',
    selectLanguage: 'Seleccionar idioma',
    settings: 'Configuración',
    theme: 'Tema',
    themeDescription: 'Elija su tema de color preferido'
  },
  menu: {
    home: 'Inicio',
    files: 'Archivos',
    contacts: 'Contactos',
    photos: 'Fotos',
    documents: 'Documentos',
    notes: 'Notas',
    audio: 'Audio',
    videos: 'Vídeos',
    tables: 'Tablas',
    analytics: 'Analíticas',
    sqlite: 'SQLite',
    console: 'Consola',
    debug: 'Depuración',
    opfs: 'OPFS',
    cacheStorage: 'Caché',
    localStorage: 'Almacenamiento Local',
    keychain: 'Llavero',
    chat: 'Chat',
    models: 'Modelos',
    admin: 'Admin',
    settings: 'Configuración'
  },
  audio: {
    play: 'Reproducir',
    pause: 'Pausar',
    previousTrack: 'Pista anterior',
    nextTrack: 'Pista siguiente',
    restart: 'Reiniciar pista',
    rewind: 'Rebobinar',
    close: 'Cerrar reproductor',
    repeatOff: 'Repetir: Desactivado',
    repeatAll: 'Repetir: Todas las pistas',
    repeatOne: 'Repetir: Pista actual'
  },
  tooltips: {
    sseConnected: 'SSE: Conectado',
    sseConnecting: 'SSE: Conectando',
    sseDisconnected: 'SSE: Desconectado',
    keychainSalt:
      'Valor aleatorio usado con tu contraseña para derivar la clave de cifrado',
    keychainKeyCheckValue:
      'Hash usado para verificar que tu contraseña es correcta sin almacenarla',
    keychainSessionWrappingKey:
      'Clave temporal que cifra los datos de tu sesión en memoria',
    keychainSessionWrappedKey:
      'Tu clave de cifrado protegida por la clave de envoltura de sesión'
  },
  contextMenu: {
    play: 'Reproducir',
    pause: 'Pausar',
    getInfo: 'Obtener información',
    viewDetails: 'Ver detalles',
    download: 'Descargar',
    edit: 'Editar',
    delete: 'Eliminar',
    exportVCard: 'Exportar vCard'
  },
  settings: {
    font: 'Fuente',
    fontDescription: 'Elige tu estilo de fuente preferido',
    fontSystem: 'Sistema',
    fontMonospace: 'Monoespaciada',
    tooltips: 'Información emergente',
    tooltipsDescription:
      'Mostrar sugerencias útiles al pasar el cursor sobre los elementos',
    tooltipsEnabled: 'Activado',
    tooltipsDisabled: 'Desactivado'
  }
} as const satisfies I18NextTranslations;
