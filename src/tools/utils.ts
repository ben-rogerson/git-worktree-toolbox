/**
 * Utility functions shared across MCP tools
 */

import * as path from "path";
import * as fsPromises from "fs/promises";
import { z } from "zod";
import { executeGitCommand } from "@/src/utils/git";
import type { WorkTree } from "@/src/workspace/types";

type ZodNamespace = typeof z;

// ============================================================================
// Type Definitions
// ============================================================================

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

/**
 * Shared parameter schemas for common tool parameters
 */
export const sharedParameters = {
  /**
   * Workspace identifier parameter - accepts task ID or absolute path
   */
  workspace_identifier: (z: ZodNamespace) =>
    z.string().describe("Task ID or absolute path to the workspace"),

  /**
   * Git repository path parameter
   */
  git_repo_path: (z: ZodNamespace) =>
    z.string().describe("Path to the Git repository directory"),

  /**
   * Optional git repository path parameter
   */
  git_repo_path_optional: (z: ZodNamespace) =>
    z
      .string()
      .optional()
      .describe(
        "Path to the Git repository directory (defaults to current directory)",
      ),

  /**
   * Task ID parameter
   */
  task_id: (z: ZodNamespace) => z.string().describe("Task ID of the workspace"),

  /**
   * Worktree name parameter
   */
  worktree_name: (z: ZodNamespace) =>
    z.string().describe("Name of the worktree"),

  /**
   * User ID parameter
   */
  user_id: (z: ZodNamespace) =>
    z
      .string()
      .optional()
      .describe("User ID (optional for anonymous operations)"),

  /**
   * Base branch parameter
   */
  base_branch: (z: ZodNamespace) =>
    z.string().optional().describe("Base branch (default: main)"),
};

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
  workspacePath: string,
  workspaceName?: string,
): MissingMetadataResponse => {
  const workspaceIdentifier =
    workspaceName || workspacePath.split("/").pop() || "workspace";

  return {
    content: [
      {
        type: "text",
        text:
          `❌ Failed to ${context}: **${workspaceIdentifier}** has no metadata\n\n` +
          `💡 **Solution**: Initialize metadata first using:\n` +
          `"initialize workspace metadata" with workspace_path: "${workspacePath}"\n\n` +
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
  workspacePath: string,
): Error => {
  return new Error(
    `No metadata found for worktree at ${workspacePath}. ` +
      `Initialize metadata using "initialize workspace metadata" tool first before ${context}.`,
  );
};

/**
 * Creates a standardized warning text for listing workspaces without metadata
 */
export const createMissingMetadataWarning = (
  workspacePath: string,
  index?: number,
): string => {
  const prefix =
    index !== undefined
      ? `**${index + 1}. ${workspacePath}**`
      : `**${workspacePath}**`;

  return (
    `${prefix}\n` +
    `  ⚠️ This git dir requires setup (No metadata found)\n` +
    `  💡 **Fix**: Use "initialize workspace metadata" with workspace_path: "${workspacePath}"\n`
  );
};
