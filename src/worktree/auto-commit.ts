/**
 * Auto-Commit System - Automatic git commit management
 *
 * This module provides comprehensive auto-commit functionality for worktree management:
 * - Enable/disable auto-commit for worktrees
 * - Force commits with customizable options
 * - Commit queue status tracking and monitoring
 * - File change tracking and counting
 * - Automatic push to remote repositories
 * - Metadata integration for persistent state management
 */

import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import type { AutoCommitInfo } from "@/src/worktree/types";
import {
  gitStatus,
  gitAdd,
  gitCommit,
  gitPush,
  gitHasRemote,
} from "@/src/utils/git";
import { createMissingMetadataError } from "@/src/tools/utils";

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

export class AutoCommitManager {
  private processing = new Set<string>();

  private readonly defaultOptions: Required<AutoCommitOptions> = {
    commitMessageTemplate:
      "Auto-commit: {fileCount} files changed at {timestamp}",
    pushToRemote: true,
  };

  async enableAutoCommit(worktreePath: string): Promise<void> {
    // Update metadata to enable auto-commit
    await this.updateMetadataStatus(worktreePath, {
      enabled: true,
    });

    console.log(`Auto-commit enabled for: ${worktreePath}`);
  }

  async disableAutoCommit(worktreePath: string): Promise<void> {
    this.processing.delete(worktreePath);

    // Update metadata to disable auto-commit (if metadata exists)
    try {
      await this.updateMetadataStatus(worktreePath, {
        enabled: false,
      });
    } catch (error) {
      // Silently handle missing metadata - this is okay during archiving
      if (
        error instanceof Error &&
        error.message.includes("No metadata found")
      ) {
        console.log(
          `No metadata found for ${worktreePath}, skipping auto-commit status update`,
        );
      } else {
        throw error;
      }
    }

    console.log(`Auto-commit disabled for: ${worktreePath}`);
  }

  async getCommitQueueStatus(worktreePath: string): Promise<CommitQueueStatus> {
    const metadata = await WorktreeMetadataManager.loadMetadata(worktreePath);

    // If no metadata, return default status (worktree needs initialization)
    if (!metadata) {
      return {
        last_commit: null,
        is_processing: false,
        pending_changes: 0,
        queue_size: 0,
        needs_initialization: true,
      };
    }

    const autoCommit = metadata.auto_commit as AutoCommitInfo;

    return {
      last_commit: autoCommit?.last_commit
        ? new Date(autoCommit.last_commit)
        : null,
      is_processing: this.processing.has(worktreePath),
      pending_changes: autoCommit?.pending_changes || 0,
      queue_size: autoCommit?.queue_size || 0,
      needs_initialization: false,
    };
  }

  async forceCommit(
    worktreePath: string,
    options: AutoCommitOptions = {},
  ): Promise<void> {
    const config = { ...this.defaultOptions, ...options };
    await this.processCommit(worktreePath, config);
  }

  private async processCommit(
    worktreePath: string,
    config: Required<AutoCommitOptions>,
  ): Promise<void> {
    if (this.processing.has(worktreePath)) {
      return; // Already processing
    }

    this.processing.add(worktreePath);

    try {
      // Check if there are actually any git changes
      const hasChanges = await this.hasGitChanges(worktreePath);
      if (!hasChanges) {
        console.log(
          `No git changes detected in ${worktreePath}, skipping commit`,
        );
        return;
      }

      // Count files to commit
      const fileCount = await this.getChangedFileCount(worktreePath);
      const timestamp = new Date().toISOString();

      // Generate commit message
      const commitMessage = config.commitMessageTemplate
        .replace("{fileCount}", fileCount.toString())
        .replace("{timestamp}", timestamp);

      // Add all changes to git
      await this.gitAddFiles(worktreePath);

      // Commit changes
      const commitHash = await this.gitCommitChanges(
        worktreePath,
        commitMessage,
      );

      // Push to remote if enabled
      if (config.pushToRemote) {
        await this.gitPushChanges(worktreePath);
      }

      // Update metadata
      await this.updateMetadataStatus(worktreePath, {
        last_commit: timestamp,
      });

      console.log(
        `Auto-committed ${fileCount} changes in ${worktreePath}: ${commitHash}`,
      );
    } catch (error) {
      console.error(`Auto-commit failed for ${worktreePath}:`, error);
      throw error;
    } finally {
      this.processing.delete(worktreePath);
    }
  }

  private async hasGitChanges(worktreePath: string): Promise<boolean> {
    try {
      const stdout = await gitStatus({ cwd: worktreePath });
      return stdout.trim().length > 0;
    } catch (error) {
      console.warn(`Failed to check git status for ${worktreePath}:`, error);
      return false;
    }
  }

  private async getChangedFileCount(worktreePath: string): Promise<number> {
    try {
      const stdout = await gitStatus({ cwd: worktreePath });
      // Count lines that indicate file changes (excluding empty lines)
      return stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().length > 0).length;
    } catch (error) {
      console.warn(`Failed to count changed files for ${worktreePath}:`, error);
      return 0;
    }
  }

  private async gitAddFiles(worktreePath: string): Promise<void> {
    try {
      await gitAdd(".", { cwd: worktreePath });
    } catch (error) {
      throw new Error(`Failed to git add in ${worktreePath}: ${error}`);
    }
  }

  private async gitCommitChanges(
    worktreePath: string,
    message: string,
  ): Promise<string> {
    try {
      const stdout = await gitCommit(message, { cwd: worktreePath });

      // Extract commit hash from output
      const hashMatch = stdout.match(/\[[\w\-\/]+ ([a-f0-9]{7,})\]/);
      return hashMatch ? hashMatch[1] : "unknown";
    } catch (error) {
      throw new Error(`Failed to git commit in ${worktreePath}: ${error}`);
    }
  }

  private async gitPushChanges(worktreePath: string): Promise<void> {
    try {
      const metadata = await WorktreeMetadataManager.loadMetadata(worktreePath);
      if (!metadata) {
        throw createMissingMetadataError("pushing changes", worktreePath);
      }

      const branchName = metadata.worktree.branch;

      // Check if origin remote exists before attempting to push
      const hasOrigin = await gitHasRemote("origin", { cwd: worktreePath });
      if (!hasOrigin) {
        console.log(
          `No 'origin' remote configured for ${worktreePath}. Skipping push.`,
        );
        return;
      }

      await gitPush("origin", branchName, { cwd: worktreePath });
    } catch (error) {
      throw new Error(`Failed to git push in ${worktreePath}: ${error}`);
    }
  }

  private async updateMetadataStatus(
    worktreePath: string,
    updates: Partial<{
      enabled: boolean;
      last_commit: string;
    }>,
  ): Promise<void> {
    try {
      await WorktreeMetadataManager.updateAutoCommitStatus(
        worktreePath,
        updates,
      );
    } catch (error) {
      console.warn(
        `Failed to update auto-commit metadata for ${worktreePath}:`,
        error,
      );
    }
  }
}

// Global instance for managing auto-commit across all worktrees
export const autoCommitManager = new AutoCommitManager();
