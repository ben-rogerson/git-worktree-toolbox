/**
 * Configuration Schemas
 *
 * Centralized Zod schema definitions for the git-worktree-toolbox project.
 * This file consolidates all validation schemas used across the application
 * for better maintainability and consistency.
 */

import { z } from "zod";

type ZodNamespace = typeof z;

// ============================================================================
// Worktree Metadata Schema
// ============================================================================

/**
 * Schema for worktree metadata validation
 * Used for validating task.config.yaml files
 */
export const WORKTREE_METADATA_SCHEMA = z.object({
  worktree: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    branch: z.string(),
    created_at: z.string(),
    created_by: z.string(),
    status: z.enum(["active", "completed", "archived"]),
  }),
  team: z.object({
    assigned_users: z.array(
      z.object({
        user_id: z.string(),
        role: z.enum(["owner", "collaborator"]),
        joined_at: z.string(),
      }),
    ),
  }),
  conversation_history: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      user_id: z.string().optional(),
      prompt: z.string(),
      response: z.string(),
    }),
  ),
  git_info: z.object({
    base_branch: z.string(),
    current_branch: z.string(),
  }),
  claude_session: z
    .object({
      enabled: z.boolean(),
      session_id: z.string(),
      created_at: z.string(),
      last_resumed_at: z.string().optional(),
      prompt_template: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

/**
 * Shared parameter schemas for common tool parameters
 * These are reusable Zod schemas for MCP tool parameters
 */
export const sharedParameters = {
  /**
   * Worktree identifier parameter - accepts task ID, worktree name, or absolute path
   */
  worktree_identifier: (z: ZodNamespace) =>
    z
      .string()
      .optional()
      .describe(
        "Task ID, worktree name, or absolute path to the worktree (defaults to current directory)",
      ),

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
  task_id: (z: ZodNamespace) => z.string().describe("Task ID of the worktree"),

  /**
   * Worktree name parameter
   */
  worktree_name: (z: ZodNamespace) =>
    z.string().describe("Name of the worktree"),

  /**
   * Base branch parameter
   */
  base_branch_optional: (z: ZodNamespace) =>
    z.string().optional().describe("Base branch (default: main)"),
};

// ============================================================================
// MCP Request/Response Schemas
// ============================================================================

/**
 * Schema for MCP tools/list request
 */
export const MCP_TOOLS_LIST_REQUEST_SCHEMA = z.object({
  method: z.literal("tools/list"),
});

/**
 * Schema for MCP tools/call request
 */
export const MCP_TOOLS_CALL_REQUEST_SCHEMA = z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.unknown()).optional(),
  }),
});

// ============================================================================
// CLI Configuration Schemas
// ============================================================================

/**
 * Schema for CLI flag definition
 */
export const CLI_FLAG_DEFINITION_SCHEMA = z.object({
  param: z.string(),
  alias: z.string(),
  description: z.string(),
});

/**
 * Schema for CLI configuration
 */
export const CLI_CONFIG_SCHEMA = z.object({
  aliases: z.array(z.string()).optional(),
  flags: z.array(CLI_FLAG_DEFINITION_SCHEMA).optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type WorktreeMetadataSchema = z.infer<typeof WORKTREE_METADATA_SCHEMA>;
export type McpToolsListRequest = z.infer<typeof MCP_TOOLS_LIST_REQUEST_SCHEMA>;
export type McpToolsCallRequest = z.infer<typeof MCP_TOOLS_CALL_REQUEST_SCHEMA>;
export type CliFlagDefinition = z.infer<typeof CLI_FLAG_DEFINITION_SCHEMA>;
export type CliConfig = z.infer<typeof CLI_CONFIG_SCHEMA>;
