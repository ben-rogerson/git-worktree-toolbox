/**
 * Worktree Manager
 *
 * High-level worktree orchestration:
 * - Create worktrees (with git worktree + metadata)
 * - Archive worktrees (update status, clean up config)
 * - Lookup by ID/path (retrieve worktree metadata)
 * - Generate MR links (GitLab/GitHub merge request URLs)
 *
 * This manager coordinates between git operations, metadata management,
 * and metadata management to provide a unified worktree lifecycle.
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
    // If branch_name is provided, use it and derive worktree name from it
    // Otherwise, generate both from task_description
    const branchName =
      options.branch_name || generateBranchName(options.task_description);
    const worktreeName =
      options.branch_name || generateWorktreeName(options.task_description);

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
          base_branch: options.base_branch,
          worktree_name: worktreeName,
          branch: branchName,
        },
      );

      // Step 3: Add conversation entry
      await WorktreeMetadataManager.addConversationEntry(worktree.path, {
        prompt: options.task_description,
        response: `Created worktree "${worktreeName}"`,
      });

      // Step 4: Execute AI agent prompt plugin if enabled
      // Only run in interactive mode (CLI). Skip in non-interactive mode (MCP)
      const { loadGlobalAIAgentConfig } = await import(
        "@/src/plugins/shared/config.js"
      );
      const { getExecutionContext } = await import("@/src/utils/constants.js");

      const executionContext = getExecutionContext();
      const aiConfig = await loadGlobalAIAgentConfig();

      // In non-interactive mode (MCP), always use permission mode for full automation
      // In interactive mode (CLI), use the default permission mode from config
      const effectivePermissionMode = executionContext.interactive
        ? (aiConfig?.permission_mode ?? false)
        : true; // Always automated in non-interactive mode

      if (aiConfig?.enabled && executionContext.interactive) {
        // INTERACTIVE MODE: Launch AI agent CLI session
        // Add a delay to allow user to read the feedback before launching AI agent
        console.log("\n⏳ Preparing AI agent...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (aiConfig.provider === "claude" || !aiConfig.last_used_provider) {
          const { executeClaudePromptForWorktree } = await import(
            "@/src/plugins/claude-prompt/index.js"
          );
          await executeClaudePromptForWorktree(
            worktree.path,
            metadata,
            options.task_description,
            effectivePermissionMode,
          );
        } else if (aiConfig.provider === "cursor") {
          const { executeCursorPromptForWorktree } = await import(
            "@/src/plugins/cursor-agent/index.js"
          );
          await executeCursorPromptForWorktree(
            worktree.path,
            metadata,
            options.task_description,
            effectivePermissionMode,
          );
        }
      } else if (aiConfig?.enabled && !executionContext.interactive) {
        // NON-INTERACTIVE MODE (MCP): Skip AI agent execution
        // AI agents require interactive sessions and console.log() breaks MCP protocol
        // The worktree is created, but no AI agent is launched
      }

      return {
        task_id: metadata.worktree.id,
        worktree_name: worktreeName,
        worktree_path: worktree.path,
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

  async archiveWorktreeByPathOrTaskId(pathOrTaskId: string): Promise<void> {
    const worktree = await this.getWorktreeByPathOrTaskId(pathOrTaskId);
    if (!worktree) {
      throw new Error(`No worktree found for task/path ${pathOrTaskId}`);
    }

    // Update metadata status
    const metadata = worktree.metadata;
    metadata.worktree.status = "archived";
    await WorktreeMetadataManager.saveMetadata(worktree.worktreePath, metadata);
  }

  async generateMRLinkByTaskId(taskId: string): Promise<string> {
    const worktree = await this.getWorktreeByTaskId(taskId);
    if (!worktree) {
      if (!taskId) {
        throw new Error("No task ID provided");
      }
      throw new Error(`No worktree found for task ${taskId}`);
    }

    const metadata = worktree.metadata;
    const branchName = metadata.worktree.branch;
    const baseBranch = metadata.git_info.base_branch;

    const repoUrl = metadata.git_info.remote_url;
    if (!repoUrl) {
      return `No remote URL found for worktree "${metadata.worktree.name}"`;
    }

    if (repoUrl.includes("gitlab")) {
      const sourceBranch = encodeURIComponent(branchName);
      const targetBranch = encodeURIComponent(baseBranch);
      return `${repoUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${sourceBranch}&merge_request%5Btarget_branch%5D=${targetBranch}`;
    } else if (repoUrl.includes("github")) {
      return `${repoUrl}/compare/${baseBranch}...${branchName}`;
    } else {
      return `Please create a merge request from branch "${branchName}" to "${baseBranch}"`;
    }
  }

  async generateMRLinkByPathOrTaskId(pathOrTaskId: string): Promise<string> {
    const worktree = await this.getWorktreeByPathOrTaskId(pathOrTaskId);
    if (!worktree) {
      if (!pathOrTaskId) {
        throw new Error("No worktree identifier provided");
      }
      throw new Error(`No worktree found for identifier ${pathOrTaskId}`);
    }

    const metadata = worktree.metadata;
    const branchName = metadata.worktree.branch;
    const baseBranch = metadata.git_info.base_branch;

    const repoUrl = metadata.git_info.remote_url;
    if (!repoUrl) {
      return `No remote URL found for worktree "${metadata.worktree.name}"`;
    }

    if (repoUrl.includes("gitlab")) {
      const sourceBranch = encodeURIComponent(branchName);
      const targetBranch = encodeURIComponent(baseBranch);
      return `${repoUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${sourceBranch}&merge_request%5Btarget_branch%5D=${targetBranch}`;
    } else if (repoUrl.includes("github")) {
      return `${repoUrl}/compare/${baseBranch}...${branchName}`;
    } else {
      return `Please create a merge request from branch "${branchName}" to "${baseBranch}"`;
    }
  }
}
