export const enUS = {
  appName: 'Metatron',

  nav: {
    chat: 'Chat',
    modelManager: 'Model Manager',
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

  errors: {
    noApiKey: 'No API key configured for this provider',
    networkError: 'Network error — please try again',
    unknown: 'An unknown error occurred',
  },
} as const;

export type Strings = typeof enUS;
