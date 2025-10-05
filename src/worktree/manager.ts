/**
 * Worktree Manager
 *
 * High-level worktree orchestration:
 * - Create worktrees (with git worktree + metadata + Claude config)
 * - Archive worktrees (update status, clean up config)
 * - Lookup by ID/path (retrieve worktree metadata)
 * - Generate MR links (GitLab/GitHub merge request URLs)
 *
 * This manager coordinates between git operations, metadata management,
 * and Claude configuration to provide a unified worktree lifecycle.
 */

import path from "path";
import { createWorkTree } from "@/src/worktree/git-operations";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import { generateWorktreeName, generateBranchName } from "@/src/utils/strings";
import {
  CreateWorktreeOptions,
  WorktreeCreationResult,
  WorktreeMetadata,
} from "@/src/worktree/types";
import { WorktreeClaudeConfigGenerator } from "@/src/claude/configGenerator";
import { ensureWorktreeHasMetadata } from "@/src/tools/worktree-lifecycle";

export interface WorktreeManagerConfig {
  base_worktrees_path?: string;
  project_directories?: string[];
}

export class WorktreeManager {
  private baseWorktreesPath: string;
  public projectDirectories?: string[];

  constructor(config: WorktreeManagerConfig) {
    this.baseWorktreesPath = config.base_worktrees_path || "../worktrees";
    this.projectDirectories = config.project_directories;
  }

  async createWorktree(
    options: CreateWorktreeOptions,
  ): Promise<WorktreeCreationResult> {
    const worktreeName = generateWorktreeName(
      options.task_description,
      options.user_id,
    );
    const branchName = generateBranchName(options.task_description);

    try {
      // Step 1: Create git worktree
      const worktree = await createWorkTree(
        worktreeName,
        branchName,
        undefined, // customPath
        options.git_repo_path,
      );

      // Step 2: Create worktree metadata
      const metadata = await WorktreeMetadataManager.createMetadata(
        worktree.path,
        {
          task_description: options.task_description,
          user_id: options.user_id,
          base_branch: options.base_branch,
          auto_invite_users: options.auto_invite_users,
          worktree_name: worktreeName,
          branch: branchName,
        },
      );

      // Step 3: Create Claude configuration with auto-commit hooks
      await WorktreeClaudeConfigGenerator.createWorktreeConfig({
        worktreePath: worktree.path,
        worktreeName: worktreeName,
        channelId: null,
        channelName: null,
      });

      // Step 4: Add conversation entry
      await WorktreeMetadataManager.addConversationEntry(worktree.path, {
        user_id: options.user_id,
        prompt: options.task_description,
        claude_response: `Created worktree "${worktreeName}" and auto-commit enabled`,
      });

      return {
        task_id: metadata.worktree.id,
        worktree_name: worktreeName,
        worktree_path: worktree.path,
        invited_users: [],
        metadata_path: await WorktreeMetadataManager.getMetadataPath(
          worktree.path,
        ),
      };
    } catch (error) {
      // Preserve original error details for better debugging
      if (error instanceof Error) {
        throw error; // Re-throw the original error with its specific message
      }
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  async getWorktreeByTaskId(taskId: string): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    const result = await WorktreeMetadataManager.getWorktreeByTaskId(
      taskId,
      path.dirname(this.baseWorktreesPath),
    );

    if (result) {
      await ensureWorktreeHasMetadata(result.worktreePath);
    }

    return result;
  }

  async getWorktreeByPathOrTaskId(pathOrTaskId: string): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    const result = await WorktreeMetadataManager.getWorktreeByPathOrTaskId(
      pathOrTaskId,
      path.dirname(this.baseWorktreesPath),
    );

    if (result) {
      await ensureWorktreeHasMetadata(result.worktreePath);
    }

    return result;
  }

  async archiveWorktreeByTaskId(taskId: string): Promise<void> {
    const worktree = await this.getWorktreeByTaskId(taskId);
    if (!worktree) {
      throw new Error(`No worktree found for task ${taskId}`);
    }

    // Update metadata status
    const metadata = worktree.metadata;
    metadata.worktree.status = "archived";
    await WorktreeMetadataManager.saveMetadata(worktree.worktreePath, metadata);

    // Clean up Claude configuration
    await WorktreeClaudeConfigGenerator.removeWorktreeConfig(
      worktree.metadata.worktree.name,
    );
  }

  async archiveWorktreeByPathOrTaskId(pathOrTaskId: string): Promise<void> {
    const worktree = await this.getWorktreeByPathOrTaskId(pathOrTaskId);
    if (!worktree) {
      throw new Error(`No worktree found for task/path ${pathOrTaskId}`);
    }

    // Update metadata status
    const metadata = worktree.metadata;
    metadata.worktree.status = "archived";
    await WorktreeMetadataManager.saveMetadata(worktree.worktreePath, metadata);

    // Clean up Claude configuration
    await WorktreeClaudeConfigGenerator.removeWorktreeConfig(
      worktree.metadata.worktree.name,
    );
  }

  async generateMRLinkByTaskId(taskId: string): Promise<string> {
    const worktree = await this.getWorktreeByTaskId(taskId);
    if (!worktree) {
      throw new Error(`No worktree found for task ${taskId}`);
    }

    const metadata = worktree.metadata;
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
