/**
 * Worktree Type Definitions
 *
 * Core types for worktree and worktree management:
 * - WorktreeMetadata: Complete worktree metadata structure (worktree info, team, conversations, git info)
 * - CreateWorktreeOptions: Parameters for creating new worktrees
 * - WorktreeCreationResult: Result data after worktree creation
 * - ConversationEntry: Individual conversation/interaction records
 */

export interface WorktreeInfo {
  id: string;
  name: string;
  path: string;
  branch: string;
  created_at?: string;
  created_by: string;
  status: "active" | "completed" | "archived";
}

export interface TeamMember {
  user_id: string;
  role: "owner" | "collaborator";
  joined_at: string;
}

export interface TeamInfo {
  assigned_users: TeamMember[];
}

export interface ConversationEntry {
  id: string;
  timestamp: string;
  user_id?: string;
  prompt: string;
  response: string;
  commit_hash?: string;
}

export interface GitInfo {
  base_branch: string;
  current_branch: string;
  remote_url?: string;
}

export interface ClaudeSessionConfig {
  enabled: boolean;
  session_id: string;
  created_at: string;
  last_resumed_at?: string;
  prompt_template?: string;
}

export interface WorktreeMetadata {
  worktree: WorktreeInfo;
  team: TeamInfo;
  conversation_history: ConversationEntry[];
  git_info: GitInfo;
  claude_session?: ClaudeSessionConfig;
}

export interface CreateWorktreeOptions {
  task_description: string;
  base_branch?: string;
  auto_invite_users?: string[];
  git_repo_path?: string;
  yolo: boolean;
}

export interface WorktreeCreationResult {
  task_id: string;
  worktree_name: string;
  worktree_path: string;
  invited_users: string[];
  metadata_path: string;
}

export interface WorkTree {
  id: string;
  name: string;
  path: string;
  branch: string;
  created: Date;
}

export interface WorkTreeError extends Error {
  code:
    | "INVALID_BRANCH"
    | "DUPLICATE_NAME"
    | "PERMISSION_DENIED"
    | "GIT_ERROR"
    | "NOT_FOUND"
    | "INVALID_OPERATION";
}
