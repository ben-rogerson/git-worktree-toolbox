/**
 * Utility functions shared across MCP tools
 */

import * as path from "path";
import { executeGitCommand } from "@/src/utils/git";
import type { WorkTree } from "@/src/worktree/types";
import { sharedParameters } from "@/src/schemas/config-schema";

// ============================================================================
// Type Definitions
// ============================================================================

// Re-export sharedParameters for backward compatibility
export { sharedParameters };

export interface ValidationError {
  [x: string]: unknown;
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export interface MissingMetadataResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

// ============================================================================
// Git Repository Detection
// ============================================================================

/**
 * Finds the nearest git repository by walking up the directory tree
 * This is more reliable than using process.cwd() when the MCP server
 * is running from a different directory than where the command was executed
 */
export const findNearestGitRepository = async (
  startPath?: string,
): Promise<string | null> => {
  const fs = await import("fs");
  const path = await import("path");

  // Start from the provided path or current working directory
  let currentPath = startPath ? path.resolve(startPath) : process.cwd();

  // Walk up the directory tree until we find a .git directory
  while (currentPath !== path.dirname(currentPath)) {
    const gitDir = path.join(currentPath, ".git");

    if (fs.existsSync(gitDir)) {
      // Check if it's a valid git repository
      try {
        await executeGitCommand("git rev-parse --git-dir", {
          cwd: currentPath,
        });
        return currentPath;
      } catch {
        // Not a valid git repository, continue searching
      }
    }

    // Move up one directory level
    currentPath = path.dirname(currentPath);
  }

  return null;
};

/**
 * Gets the correct git repository path, preferring explicit path over auto-detection
 */
export const getGitRepositoryPath = async (
  explicitPath?: string,
): Promise<string | null> => {
  // If explicit path provided, validate it
  if (explicitPath) {
    try {
      await executeGitCommand("git rev-parse --git-dir", { cwd: explicitPath });
      return path.resolve(explicitPath);
    } catch {
      return null;
    }
  }

  // Otherwise, find the nearest git repository
  return await findNearestGitRepository();
};

// ============================================================================
// Git Repository Validation
// ============================================================================

/**
 * Validates that a given path is a valid, accessible git repository
 */
export const assertGitRepoPath = async (
  git_repo_path?: string,
): Promise<ValidationError | null> => {
  // Use the new detection function instead of process.cwd()
  const targetPath = await getGitRepositoryPath(git_repo_path);

  if (!targetPath) {
    return {
      content: [
        {
          type: "text",
          text: `❌ No git repository found${git_repo_path ? ` at: ${git_repo_path}` : ""}\n\nRun 'git init' in a directory first, or navigate to a git repository.`,
        },
      ],
    };
  }

  // All validations passed (we already validated it's a git repo in getGitRepositoryPath)
  return null;
};

// ============================================================================
// Worktree Validation
// ============================================================================

/**
 * Validates that a worktree name exists in the list of available worktrees
 */
export const assertWorktreeName = async (
  workTrees: WorkTree[],
  worktreeName: string,
): Promise<ValidationError | undefined> => {
  if (worktreeName) {
    const targetWorkTree = workTrees.find((wt) => wt.name === worktreeName);

    if (targetWorkTree) {
      return;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `❌ Worktree '${worktreeName}' not found.\n\nAvailable worktrees:\n${workTrees.map((wt) => `• ${wt.name} (${wt.branch})`).join("\n")}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `❌ Worktree name is required.\n\nAvailable worktrees:\n${workTrees.map((wt) => `• ${wt.name} (${wt.branch})`).join("\n")}`,
      },
    ],
  };
};

// ============================================================================
// Metadata Error Responses
// ============================================================================

/**
 * Creates a standardized response for missing metadata with initialization instructions
 */
export const createMissingMetadataResponse = (
  context: string,
  worktreePath: string,
  worktreeName?: string,
): MissingMetadataResponse => {
  const worktreeIdentifier =
    worktreeName || worktreePath.split("/").pop() || "worktree";

  return {
    content: [
      {
        type: "text",
        text:
          `❌ Failed to ${context}: ${worktreeIdentifier} has no metadata\n\n` +
          `💡 Solution: Run the "doctor" tool to initialize metadata for all worktrees.\n\n` +
          `This will create the necessary metadata so you can then ${context}.`,
      },
    ],
  };
};

/**
 * Creates a standardized error message for missing metadata in non-tool contexts
 */
export const createMissingMetadataError = (
  context: string,
  worktreePath: string,
): Error => {
  return new Error(
    `No metadata found for worktree at ${worktreePath}. ` +
      `Run the "doctor" tool first to initialize metadata before ${context}.`,
  );
};

/**
 * Creates a standardized warning text for listing worktrees without metadata
 */
export const createMissingMetadataWarning = (
  worktreePath: string,
  index?: number,
): string => {
  const prefix =
    index !== undefined ? `${index + 1}. ${worktreePath}` : `${worktreePath}`;

  return (
    `${prefix}\n` +
    `  ⚠️ This git dir requires setup (No metadata found)\n` +
    `  💡 Fix: Run the "doctor" tool to initialize metadata\n`
  );
};
