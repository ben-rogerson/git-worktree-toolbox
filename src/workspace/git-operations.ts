/**
 * Git Worktree Operations
 *
 * Low-level git worktree commands: create/list/remove worktrees, branch validation, metadata persistence.
 * Provides core functionality for managing git worktrees with persistent metadata tracking.
 *
 * Key exports:
 * - createWorkTree: Create a new git worktree with metadata
 * - listWorkTrees: List all worktrees with their metadata
 * - removeWorkTree: Remove a worktree and its metadata
 * - Helper functions for metadata management and branch validation
 */

import { v4 as uuidv4 } from "uuid";
import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitWorktreeList,
  gitBranchExists,
  gitCreateBranch,
  gitHasCommits,
} from "@/src/utils/git";
import {
  ensureDirectory,
  writeFileWithDirectory,
  removeFileOrDirectory,
} from "@/src/utils/fs";
import { METADATA_DIR } from "@/src/utils/constants";
import { assertGitRepoPath } from "@/src/tools/utils";
import { WorkTree, WorkTreeError } from "@/src/workspace/types";

export interface WorktreeMetadataFile {
  id: string;
  name: string;
  path: string;
  branch: string;
  created: Date;
  lastModified: Date;
}

const METADATA_FILE = "task.config.yaml";

/**
 * Create a WorkTree error with a specific code
 */
function createWorkTreeError(
  message: string,
  code: WorkTreeError["code"],
): WorkTreeError {
  const error = new Error(message) as WorkTreeError;
  error.code = code;
  return error;
}

/**
 * Validate branch name according to Git rules
 */
function isValidBranchName(branch: string): boolean {
  if (!branch || branch.trim() === "") return false;

  // Git branch name rules
  const invalidPatterns = [
    /\.\./, // no consecutive dots
    /^-/, // cannot start with dash
    /-$/, // cannot end with dash
    /[\s~^:?*\[\]\\]/, // no special characters
    /\.$/, // cannot end with dot
    /\/@\{/, // no @{ sequences
    /\/$/, // cannot end with slash
    /^\/|\/\//, // no leading slash or consecutive slashes
  ];

  return !invalidPatterns.some((pattern) => pattern.test(branch));
}

/**
 * Get the metadata directory path for a worktree
 */
function getMetadataDir(worktreePath: string): string {
  return path.join(worktreePath, METADATA_DIR);
}

/**
 * Get the metadata file path for a worktree
 */
function getMetadataFilePath(worktreePath: string): string {
  return path.join(getMetadataDir(worktreePath), METADATA_FILE);
}

/**
 * Save worktree metadata
 */
async function saveMetadata(worktree: WorkTree): Promise<void> {
  const metadataFile = getMetadataFilePath(worktree.path);

  try {
    const metadata: WorktreeMetadataFile = {
      ...worktree,
      lastModified: new Date(),
    };

    await writeFileWithDirectory(
      metadataFile,
      yaml.dump(metadata, { indent: 2, lineWidth: 120, quotingType: '"' }),
    );
  } catch (error) {
    throw createWorkTreeError(
      `Failed to save metadata: ${error}`,
      "PERMISSION_DENIED",
    );
  }
}

/**
 * Load worktree metadata
 */
async function loadMetadata(
  worktreePath: string,
): Promise<WorktreeMetadataFile | null> {
  const metadataFile = getMetadataFilePath(worktreePath);

  try {
    const content = await fs.readFile(metadataFile, "utf-8");
    const metadata = yaml.load(content) as WorktreeMetadataFile;

    // Convert date strings back to Date objects
    metadata.created = new Date(metadata.created);
    metadata.lastModified = new Date(metadata.lastModified);

    return metadata;
  } catch {
    return null; // Metadata doesn't exist or is corrupted
  }
}

/**
 * Create a new git worktree with metadata
 */
export async function createWorkTree(
  name: string,
  branch: string,
  customPath?: string,
  gitRepoPath?: string,
): Promise<WorkTree> {
  // Validate inputs
  if (!name || name.trim() === "") {
    throw createWorkTreeError(
      "Work tree name is required",
      "INVALID_OPERATION",
    );
  }

  if (!isValidBranchName(branch)) {
    throw createWorkTreeError(
      `Invalid branch name: ${branch}`,
      "INVALID_BRANCH",
    );
  }

  // Check for existing work trees with same name
  try {
    const existingWorkTrees = await listWorkTrees(gitRepoPath);
    const existingNames = existingWorkTrees.map((wt) => wt.name);
    if (existingNames.includes(name)) {
      throw createWorkTreeError(
        `Work tree with name '${name}' already exists`,
        "DUPLICATE_NAME",
      );
    }
  } catch (error) {
    if ((error as WorkTreeError).code === "DUPLICATE_NAME") {
      throw error;
    }
    // If listWorkTrees fails, continue (maybe first worktree)
  }

  const workTreePath = customPath || path.resolve(`../worktrees/${name}`);
  const gitOptions = gitRepoPath ? { cwd: gitRepoPath } : {};

  // Validate path permissions by trying to create parent directory
  try {
    const parentDir = path.dirname(workTreePath);
    await ensureDirectory(parentDir);

    // Check if path already exists
    try {
      await fs.access(workTreePath);
      throw createWorkTreeError(
        `Path already exists: ${workTreePath}`,
        "INVALID_OPERATION",
      );
    } catch {
      // Path doesn't exist, which is what we want
    }
  } catch (error) {
    if ((error as WorkTreeError).code) {
      throw error;
    }
    throw createWorkTreeError(
      `Permission denied: Cannot create worktree at ${workTreePath}`,
      "PERMISSION_DENIED",
    );
  }

  // Check if branch exists, create if it doesn't
  try {
    const branchExists = await gitBranchExists(branch, gitOptions);
    if (!branchExists) {
      // Check if repository has any commits
      const hasCommits = await gitHasCommits(gitOptions);
      if (!hasCommits) {
        throw createWorkTreeError(
          `Cannot create branch '${branch}' in empty repository. Please make an initial commit first.`,
          "GIT_ERROR",
        );
      }
      await gitCreateBranch(branch, "HEAD", gitOptions);
    }
  } catch (error: unknown) {
    throw createWorkTreeError(
      `Failed to verify or create branch '${branch}': ${error instanceof Error ? error.message : String(error)}`,
      "GIT_ERROR",
    );
  }

  // Create the git worktree
  try {
    await gitWorktreeAdd(workTreePath, branch, gitOptions);
  } catch (error: unknown) {
    throw createWorkTreeError(
      `Failed to create work tree: ${error instanceof Error ? error.message : String(error)}`,
      "GIT_ERROR",
    );
  }

  // Create worktree object with persistent ID
  const workTree: WorkTree = {
    id: uuidv4(),
    name,
    path: workTreePath,
    branch,
    created: new Date(),
  };

  // Save metadata
  try {
    await saveMetadata(workTree);
  } catch (error) {
    // If metadata save fails, try to clean up the worktree
    try {
      await gitWorktreeRemove(workTreePath, true, gitOptions);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }

  return workTree;
}

/**
 * List all git worktrees with their metadata
 */
export async function listWorkTrees(gitRepoPath?: string): Promise<WorkTree[]> {
  if (gitRepoPath) {
    const result = await assertGitRepoPath(gitRepoPath);
    if (result) {
      throw createWorkTreeError(
        `Invalid Git repository path: ${gitRepoPath}`,
        "INVALID_OPERATION",
      );
    }
  }
  try {
    const options = gitRepoPath ? { cwd: gitRepoPath } : {};
    const stdout = await gitWorktreeList(options);

    const workTrees: WorkTree[] = [];
    const entries = stdout.trim().split("\n\n");

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const lines = entry.split("\n");
      let workTreePath = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          workTreePath = line.substring(9).trim();
        } else if (line.startsWith("branch ")) {
          branch = line.substring(7).trim();
        }
      }

      if (workTreePath) {
        try {
          // Try to load metadata first for persistent ID and details
          const metadata = await loadMetadata(workTreePath);

          if (metadata) {
            // Use metadata if available
            workTrees.push({
              id: metadata.id,
              name: metadata.name,
              path: metadata.path,
              branch: metadata.branch,
              created: metadata.created,
            });
          } else {
            // Fallback: create entry without metadata (existing worktrees)
            const name = path.basename(workTreePath);
            let created = new Date();

            try {
              const stats = await fs.stat(workTreePath);
              created = stats.birthtime || stats.mtime;
            } catch {
              // Use current date if stat fails
            }

            const workTree: WorkTree = {
              id: uuidv4(),
              name,
              path: workTreePath,
              branch: branch || "unknown",
              created,
            };

            // Try to save metadata for future use
            try {
              await saveMetadata(workTree);
            } catch {
              // Ignore metadata save errors for existing worktrees
            }

            workTrees.push(workTree);
          }
        } catch (error) {
          // Filter out corrupted/invalid worktrees
          console.warn(
            `Skipping corrupted worktree at ${workTreePath}:`,
            error,
          );
          continue;
        }
      }
    }

    // Sort by creation date (oldest first)
    return workTrees.sort((a, b) => a.created.getTime() - b.created.getTime());
  } catch (error: unknown) {
    throw createWorkTreeError(
      `Failed to list work trees: ${error instanceof Error ? error.message : String(error)}`,
      "GIT_ERROR",
    );
  }
}

/**
 * Remove a git worktree and its metadata
 */
export async function removeWorkTree(
  name: string,
  force = false,
): Promise<void> {
  if (!name || name.trim() === "") {
    throw createWorkTreeError(
      "Work tree name is required",
      "INVALID_OPERATION",
    );
  }

  try {
    // First, get the list of work trees to find the path
    const workTrees = await listWorkTrees();
    const targetWorkTree = workTrees.find((wt) => wt.name === name);

    if (!targetWorkTree) {
      throw createWorkTreeError(`Work tree '${name}' not found`, "NOT_FOUND");
    }

    // Prevent removal of main work tree with multiple checks
    const currentDir = process.cwd();
    const targetPath = path.resolve(targetWorkTree.path);

    if (
      targetPath === currentDir ||
      targetPath === path.resolve(".") ||
      targetWorkTree.path.endsWith("/.") ||
      targetWorkTree.path === "." ||
      (targetWorkTree.branch === "main" &&
        targetPath.includes(path.basename(currentDir)))
    ) {
      throw createWorkTreeError(
        "Cannot remove main work tree",
        "INVALID_OPERATION",
      );
    }

    // Try normal removal first, then force if needed
    try {
      await gitWorktreeRemove(targetWorkTree.path, false);
    } catch (error: unknown) {
      if (
        force ||
        (error instanceof Error &&
          (error.message.includes("locked") ||
            error.message.includes("modified")))
      ) {
        // Retry with force flag
        try {
          await gitWorktreeRemove(targetWorkTree.path, true);
        } catch (forceError: unknown) {
          throw createWorkTreeError(
            `Failed to force remove work tree: ${forceError instanceof Error ? forceError.message : String(forceError)}`,
            "GIT_ERROR",
          );
        }
      } else {
        throw createWorkTreeError(
          `Failed to remove work tree: ${error instanceof Error ? error.message : String(error)}. Try with force option.`,
          "GIT_ERROR",
        );
      }
    }

    // Clean up metadata directory if it still exists
    try {
      const metadataDir = getMetadataDir(targetWorkTree.path);
      await removeFileOrDirectory(metadataDir);
    } catch (error) {
      // Don't fail the operation if metadata cleanup fails
      console.warn("Failed to clean up metadata:", error);
    }
  } catch (error: unknown) {
    if ((error as WorkTreeError).code) {
      throw error;
    }
    throw createWorkTreeError(
      `Failed to remove work tree: ${error instanceof Error ? error.message : String(error)}`,
      "GIT_ERROR",
    );
  }
}
