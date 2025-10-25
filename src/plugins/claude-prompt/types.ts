/**
 * Claude Prompt Plugin Types
 *
 * Type definitions for the Claude CLI auto-prompt plugin.
 * This plugin enables automatic Claude CLI session launching when creating worktrees.
 */

export interface ClaudeSessionConfig {
  enabled: boolean;
  session_id: string;
  created_at: string;
  last_resumed_at?: string;
  prompt_template?: string;
}

export interface GlobalClaudeConfig {
  enabled: boolean;
  prompt_template?: string;
  permission_mode: boolean;
  execution_mode?: boolean;
}

export interface ExecuteClaudePromptOptions {
  worktreePath: string;
  sessionId: string;
  prompt: string;
  permissionMode?: boolean;
}

export interface ResumeClaudeSessionOptions {
  worktreePath: string;
  sessionId: string;
  prompt?: string;
  permissionMode?: boolean;
}
