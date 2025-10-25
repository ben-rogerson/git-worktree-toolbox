/**
 * Cursor Agent Plugin Types
 *
 * Type definitions for the Cursor Agent CLI plugin.
 * This plugin enables automatic Cursor Agent CLI session launching when creating worktrees.
 */

export interface CursorSessionConfig {
  enabled: boolean;
  chat_id: string;
  created_at: string;
  last_resumed_at?: string;
  prompt_template?: string;
}

export interface ExecuteCursorPromptOptions {
  worktreePath: string;
  chatId: string;
  prompt: string;
  forceMode?: boolean;
}

export interface ResumeCursorSessionOptions {
  worktreePath: string;
  chatId: string;
  prompt?: string;
  forceMode?: boolean;
}
