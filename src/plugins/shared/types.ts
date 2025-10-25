/**
 * Shared AI Agent Plugin Types
 *
 * Common type definitions shared across AI agent plugins (Claude, Cursor, etc.)
 */

export type AIAgentProvider = "claude" | "cursor";

export interface GlobalAIAgentConfig {
  enabled: boolean;
  provider: AIAgentProvider;
  last_used_provider?: AIAgentProvider;
  prompt_template?: string;
  permission_mode: boolean;
}

export interface TemplateVariables {
  task_description: string;
  branch: string;
  base_branch: string;
  worktree_path: string;
  worktree_name: string;
}
