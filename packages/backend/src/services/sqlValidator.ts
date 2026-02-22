const PROTECTED_TABLES = ['chats', 'messages', 'settings'];

export function validateAIQuery(sql: string): { valid: boolean; error?: string } {
  for (const table of PROTECTED_TABLES) {
    const regex = new RegExp(`\\b${table}\\b`, 'i');
    if (regex.test(sql)) {
      return {
        valid: false,
        error: `Access denied: the '${table}' table is a protected core table. You can only create and manage tables with the 'ai_' prefix.`,
      };
    }
  }

  return { valid: true };
}
