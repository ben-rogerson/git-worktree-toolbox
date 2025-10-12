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
import {
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitWorktreeList,
  gitBranchExists,
  gitCreateBranch,
  gitHasCommits,
  gitCreateInitialCommit,
} from "@/src/utils/git";
import { ensureDirectory } from "@/src/utils/fs";
import { assertGitRepoPath } from "@/src/tools/utils";
import { WorkTree, WorkTreeError } from "@/src/worktree/types";

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

  let workTreePath: string;
  if (customPath) {
    workTreePath = customPath;
  } else {
    const currentDir = process.cwd();
    if (currentDir.includes("/worktrees/")) {
      const worktreesIndex = currentDir.indexOf("/worktrees/");
      const basePath = currentDir.substring(
        0,
        worktreesIndex + "/worktrees".length,
      );
      workTreePath = path.join(basePath, name);
    } else {
      workTreePath = path.resolve(`../worktrees/${name}`);
    }
  }
  const gitOptions = gitRepoPath ? { cwd: gitRepoPath } : {};

  // Early validation: Check if worktrees parent folder can be created
  const worktreesParentDir = path.dirname(workTreePath);
  try {
    await ensureDirectory(worktreesParentDir);
  } catch (error) {
    throw createWorkTreeError(
      `Cannot create worktrees folder at ${worktreesParentDir}. ` +
        `This may be due to insufficient permissions or an invalid path. ` +
        `You can customize the worktrees location by setting the BASE_WORKTREES_PATH environment variable.`,
      "PERMISSION_DENIED",
    );
  }

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
      `Permission denied: Cannot create worktree at ${workTreePath}. ` +
        `Check file permissions or set BASE_WORKTREES_PATH environment variable to a writable location.`,
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
        // Create an initial commit to allow branch creation
        await gitCreateInitialCommit(gitOptions);
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
          const name = path.basename(workTreePath);
          let created = new Date();

          try {
            const stats = await fs.stat(workTreePath);
            created = stats.birthtime || stats.mtime;
          } catch {
            // Use current date if stat fails
          }

          // Strip refs/heads/ prefix from branch name
          const cleanBranch = branch
            ? branch.replace(/^refs\/heads\//, "")
            : "unknown";

          const workTree: WorkTree = {
            id: uuidv4(),
            name,
            path: workTreePath,
            branch: cleanBranch,
            created,
          };

          workTrees.push(workTree);
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
