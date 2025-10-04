/**
 * Workspace Type Definitions
 *
 * Core types for workspace and worktree management:
 * - WorktreeMetadata: Complete workspace metadata structure (worktree info, team, conversations, git info)
 * - CreateWorkspaceOptions: Parameters for creating new workspaces
 * - WorkspaceCreationResult: Result data after workspace creation
 * - ConversationEntry: Individual conversation/interaction records
 * - AutoCommitInfo: Auto-commit status and statistics
 */

export interface WorktreeInfo {
  id: string;
  name: string;
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
  claude_response: string;
  commit_hash?: string;
}

export interface AutoCommitInfo {
  enabled: boolean;
  last_commit: string | null;
  pending_changes: number;
  queue_size: number;
}

export interface GitInfo {
  base_branch: string;
  current_branch: string;
  remote_url?: string;
}

export interface WorktreeMetadata {
  worktree: WorktreeInfo;
  team: TeamInfo;
  conversation_history: ConversationEntry[];
  auto_commit: AutoCommitInfo;
  git_info: GitInfo;
}

export interface CreateWorkspaceOptions {
  task_description: string;
  user_id?: string;
  base_branch?: string;
  auto_invite_users?: string[];
  git_repo_path?: string;
}

export interface WorkspaceCreationResult {
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

export interface AutoCommitOptions {
  commitMessageTemplate?: string;
  pushToRemote?: boolean;
}

export interface CommitQueueStatus {
  last_commit: Date | null;
  is_processing: boolean;
  pending_changes: number;
  queue_size: number;
  needs_initialization?: boolean;
}
