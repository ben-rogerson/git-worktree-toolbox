/**
 * Workspace Manager
 *
 * High-level workspace orchestration:
 * - Create workspaces (with git worktree + metadata + Claude config)
 * - Archive workspaces (update status, clean up config)
 * - Lookup by ID/path (retrieve workspace metadata)
 * - Generate MR links (GitLab/GitHub merge request URLs)
 *
 * This manager coordinates between git operations, metadata management,
 * and Claude configuration to provide a unified workspace lifecycle.
 */

import path from "path";
import { createWorkTree } from "@/src/workspace/git-operations";
import { WorkspaceMetadataManager } from "@/src/workspace/metadata";
import { generateWorkspaceName, generateBranchName } from "@/src/utils/strings";
import {
  CreateWorkspaceOptions,
  WorkspaceCreationResult,
  WorktreeMetadata,
} from "@/src/workspace/types";
import { WorkspaceClaudeConfigGenerator } from "@/src/claude/configGenerator";

export interface WorkspaceManagerConfig {
  base_worktrees_path?: string;
  project_directories?: string[];
}

export class WorkspaceManager {
  private baseWorktreesPath: string;
  public projectDirectories?: string[];

  constructor(config: WorkspaceManagerConfig) {
    this.baseWorktreesPath = config.base_worktrees_path || "../worktrees";
    this.projectDirectories = config.project_directories;
  }

  async createWorkspace(
    options: CreateWorkspaceOptions,
  ): Promise<WorkspaceCreationResult> {
    const workspaceName = generateWorkspaceName(
      options.task_description,
      options.user_id,
    );
    const branchName = generateBranchName(options.task_description);

    try {
      // Step 1: Create git worktree
      const worktree = await createWorkTree(
        workspaceName,
        branchName,
        undefined, // customPath
        options.git_repo_path,
      );

      // Step 2: Create workspace metadata
      const metadata = await WorkspaceMetadataManager.createMetadata(
        worktree.path,
        {
          task_description: options.task_description,
          user_id: options.user_id,
          base_branch: options.base_branch,
          auto_invite_users: options.auto_invite_users,
          worktree_name: workspaceName,
          branch: branchName,
        },
      );

      // Step 3: Create Claude configuration with auto-commit hooks
      await WorkspaceClaudeConfigGenerator.createWorkspaceConfig({
        worktreePath: worktree.path,
        workspaceName: workspaceName,
        channelId: null,
        channelName: null,
      });

      // Step 4: Add conversation entry
      await WorkspaceMetadataManager.addConversationEntry(worktree.path, {
        user_id: options.user_id,
        prompt: options.task_description,
        claude_response: `Created workspace "${workspaceName}" and auto-commit enabled`,
      });

      return {
        task_id: metadata.worktree.id,
        worktree_name: workspaceName,
        worktree_path: worktree.path,
        invited_users: [],
        metadata_path: await WorkspaceMetadataManager.getMetadataPath(
          worktree.path,
        ),
      };
    } catch (error) {
      // Preserve original error details for better debugging
      if (error instanceof Error) {
        throw error; // Re-throw the original error with its specific message
      }
      throw new Error(`Failed to create workspace: ${error}`);
    }
  }

  async getWorkspaceByTaskId(taskId: string): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    return await WorkspaceMetadataManager.getWorkspaceByTaskId(
      taskId,
      path.dirname(this.baseWorktreesPath),
    );
  }

  async getWorkspaceByPathOrTaskId(pathOrTaskId: string): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    return await WorkspaceMetadataManager.getWorkspaceByPathOrTaskId(
      pathOrTaskId,
      path.dirname(this.baseWorktreesPath),
    );
  }

  async archiveWorkspaceByTaskId(taskId: string): Promise<void> {
    const workspace = await this.getWorkspaceByTaskId(taskId);
    if (!workspace) {
      throw new Error(`No workspace found for task ${taskId}`);
    }

    // Update metadata status
    const metadata = workspace.metadata;
    metadata.worktree.status = "archived";
    await WorkspaceMetadataManager.saveMetadata(
      workspace.worktreePath,
      metadata,
    );

    // Clean up Claude configuration
    await WorkspaceClaudeConfigGenerator.removeWorkspaceConfig(
      workspace.metadata.worktree.name,
    );
  }

  async archiveWorkspaceByPathOrTaskId(pathOrTaskId: string): Promise<void> {
    const workspace = await this.getWorkspaceByPathOrTaskId(pathOrTaskId);
    if (!workspace) {
      throw new Error(`No workspace found for task/path ${pathOrTaskId}`);
    }

    // Update metadata status
    const metadata = workspace.metadata;
    metadata.worktree.status = "archived";
    await WorkspaceMetadataManager.saveMetadata(
      workspace.worktreePath,
      metadata,
    );

    // Clean up Claude configuration
    await WorkspaceClaudeConfigGenerator.removeWorkspaceConfig(
      workspace.metadata.worktree.name,
    );
  }

  async generateMRLinkByTaskId(taskId: string): Promise<string> {
    const workspace = await this.getWorkspaceByTaskId(taskId);
    if (!workspace) {
      throw new Error(`No workspace found for task ${taskId}`);
    }

    const metadata = workspace.metadata;
    const branchName = metadata.worktree.branch;
    const baseBranch = metadata.git_info.base_branch;

    // This is a placeholder - you would replace with your actual GitLab/GitHub URL
    const repoUrl =
      metadata.git_info.remote_url || "https://gitlab.com/your-org/your-repo";

    if (repoUrl.includes("gitlab")) {
      return `${repoUrl}/-/merge_requests/new?merge_request[source_branch]=${branchName}&merge_request[target_branch]=${baseBranch}`;
    } else if (repoUrl.includes("github")) {
      return `${repoUrl}/compare/${baseBranch}...${branchName}`;
    } else {
      return `Please create a merge request from branch "${branchName}" to "${baseBranch}"`;
    }
  }
}
