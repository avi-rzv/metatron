export const enUS = {
  appName: 'Metatron',

  nav: {
    chat: 'Chat',
    modelManager: 'Model Manager',
    systemInstruction: 'System Instruction',
  },

  sidebar: {
    open: 'Open menu',
    close: 'Close menu',
  },

  user: {
    name: 'User',
    logout: 'Logout',
  },

  chat: {
    newChat: 'New Chat',
    pastChats: 'Past Chats',
    noChats: 'No chats yet',
    startNewChat: 'Start a new conversation',
    send: 'Send message',
    copy: 'Copy',
    copied: 'Copied!',
    typeMessage: 'Type a message…',
    attach: 'Attach file',
    selectModel: 'Select model',
    deleteChat: 'Delete chat',
    today: 'Today',
    yesterday: 'Yesterday',
    thinking: 'Thinking…',
    errorSending: 'Error sending message',
  },

  modelSelector: {
    google: 'Google',
    openai: 'OpenAI',
    gemini3Pro: 'Gemini 3 Pro',
    gemini3Flash: 'Gemini 3 Flash',
    gpt52: 'GPT 5.2',
    gpt5Mini: 'GPT 5-Mini',
    gpt5Nano: 'GPT 5-Nano',
  },

  modelManager: {
    title: 'Model Manager',
    subtitle: 'Manage API keys and default models',
    google: 'Google',
    openai: 'OpenAI',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'Paste your API key here',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved!',
    defaultModel: 'Default Model',
    thinkingLevel: 'Thinking Level',
    reasoningEffort: 'Reasoning Effort',
    imageModel: 'Image Model',
    thinkingLevels: {
      MINIMAL: 'Minimal',
      LOW: 'Low',
      MEDIUM: 'Medium',
      HIGH: 'High',
    },
    reasoningEfforts: {
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    },
    geminiModels: {
      'gemini-3-pro-preview': 'Gemini 3 Pro',
      'gemini-3-flash-preview': 'Gemini 3 Flash',
    },
    openaiModels: {
      'gpt-5.2': 'GPT 5.2',
      'gpt-5-mini': 'GPT 5-Mini',
      'gpt-5-nano': 'GPT 5-Nano',
    },
    geminiImageModels: {
      'gemini-3-pro-image-preview': 'Nano Banana Pro',
      'gemini-2.5-flash-image': 'Nano Banana',
    },
    openaiImageModels: {
      'gpt-image-1': 'GPT Image 1',
      'gpt-image-1-mini': 'GPT Image 1-Mini',
      'gpt-image-1.5': 'GPT Image 1.5',
    },
    noApiKey: 'Add an API key to use this provider',
    keySecured: 'Key stored securely (encrypted)',
  },

  systemInstruction: {
    title: 'System Instruction',
    subtitle: 'Configure AI identity, persistent memory, and database access',
    coreInstruction: 'Core Instruction',
    coreInstructionDescription: 'This instruction is injected into every chat session. It defines who the AI is and how it behaves.',
    coreInstructionPlaceholder: 'Enter the system instruction for the AI...',
    memory: 'Dynamic Memory',
    memoryDescription: 'Critical facts the AI stores about you. The AI manages this via the save_memory tool.',
    memoryPlaceholder: 'No memories stored yet. The AI will populate this as you chat.',
    enableTools: 'Enable AI Tools',
    enableToolsDescription: 'Allow the AI to save memories, query its database, and manage schema',
    charCount: 'characters',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved!',
    clear: 'Clear',
    clearMemoryConfirm: 'Clear all AI memories? This cannot be undone.',
    clearSchemaConfirm: 'Clear the AI database schema documentation? This cannot be undone.',
    dbSchema: 'Database Schema',
    dbSchemaDescription: 'Documentation of tables the AI has created. The AI manages this via the update_db_schema tool.',
    dbSchemaPlaceholder: 'No custom tables created yet.',
    lastUpdated: 'Last updated',
  },

  errors: {
    noApiKey: 'No API key configured for this provider',
    networkError: 'Network error — please try again',
    unknown: 'An unknown error occurred',
  },
} as const;

export type Strings = typeof enUS;
