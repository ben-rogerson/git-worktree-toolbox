/**
 * Utility functions shared across MCP tools
 */

import * as path from "path";
import * as fsPromises from "fs/promises";
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
// Git Repository Validation
// ============================================================================

/**
 * Validates that a given path is a valid, accessible git repository
 */
export const assertGitRepoPath = async (
  git_repo_path?: string,
): Promise<ValidationError | null> => {
  // Default to current working directory if not provided
  const targetPath = git_repo_path || process.cwd();

  // Resolve to absolute path
  const resolvedPath = path.resolve(targetPath);

  // Check if path exists
  try {
    const stats = await fsPromises.stat(resolvedPath);
    if (!stats.isDirectory()) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Path exists but is not a directory: ${resolvedPath}`,
          },
        ],
      };
    }
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === "ENOENT") {
      return {
        content: [
          {
            type: "text",
            text: `❌ Directory does not exist: ${resolvedPath}`,
          },
        ],
      };
    } else if (err.code === "EACCES") {
      return {
        content: [
          {
            type: "text",
            text: `❌ Permission denied accessing: ${resolvedPath}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to access path: ${err.message}`,
          },
        ],
      };
    }
  }

  // Check if it's a git repository
  try {
    await executeGitCommand("git rev-parse --git-dir", { cwd: resolvedPath });
  } catch (error: unknown) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Not a git repository: ${resolvedPath}\n\nRun 'git init' in this directory first.`,
        },
      ],
    };
  }

  // All validations passed
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
