/**
 * Workspace Lifecycle Tools - MCP tools for workspace management:
 * create (createTaskWorkspace), archive (archiveWorkspace), launch (launchWorkspace),
 * list (listWorkspaces), info (getWorkspaceInfo), initialize (initializeWorkspaceMetadata)
 */

import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { autoCommitManager } from "@/src/workspace/auto-commit";
import { WorkspaceMetadataManager } from "@/src/workspace/metadata";
import type { McpTool } from "@/src/tools/types";
import type { WorkspaceManager } from "@/src/workspace/manager";
import {
  gitHasPendingChanges,
  gitWorktreeRemove,
  gitDeleteBranch,
  gitCurrentBranch,
  detectWorktreeOwnerRepo,
  gitStatus,
  gitDiffStats,
} from "@/src/utils/git";

import {
  assertGitRepoPath,
  createMissingMetadataResponse,
  createMissingMetadataWarning,
  sharedParameters,
} from "./utils";

// ============================================================================
// Tool: Create Task Workspace
// ============================================================================

export const createTaskWorkspace = {
  name: "create task workspace",
  description:
    "Create a new workspace and git worktree in a specific git repository",
  parameters: (z) => ({
    task_description: z
      .string()
      .describe("Description of the task or feature to work on"),
    git_repo_path: sharedParameters.git_repo_path_optional(z),
    user_id: sharedParameters.user_id(z),
    base_branch: sharedParameters.base_branch(z),
  }),
  cb: async (
    args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => {
    const { task_description, user_id, base_branch, git_repo_path } = args as {
      task_description: string;
      user_id?: string;
      base_branch?: string;
      git_repo_path?: string;
    };

    const result = await assertGitRepoPath(git_repo_path);
    if (result) {
      return result;
    }

    if (!task_description) {
      return {
        content: [
          {
            type: "text",
            text: "❌ task_description is required",
          },
        ],
      };
    }

    try {
      const wsResult = await workspaceManager.createWorkspace({
        task_description,
        user_id,
        base_branch,
        git_repo_path,
      });

      // Enable auto-commit
      await autoCommitManager.enableAutoCommit(wsResult.worktree_path);

      return {
        content: [
          {
            type: "text",
            text:
              `✅ Workspace created successfully!\n\n` +
              `**Task ID:** ${wsResult.task_id}\n` +
              `**Integration:** Workspace-only mode\n` +
              `**Worktree:** ${wsResult.worktree_name}\n` +
              `**Path:** ${wsResult.worktree_path}\n` +
              `**Auto-commit:** Enabled\n` +
              `**Metadata:** ${wsResult.metadata_path}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      let userFriendlyMessage = `❌ Failed to create workspace: ${errorMessage}`;

      // Provide specific guidance for common errors
      if (errorMessage.includes("WorkTreeError")) {
        userFriendlyMessage =
          `❌ **Git Worktree Error**\n\n` +
          `Failed to create git worktree. Common causes:\n` +
          `• Base branch doesn't exist\n` +
          `• Insufficient git permissions\n` +
          `• Disk space issues\n\n` +
          `Error: ${errorMessage}`;
      }

      return {
        content: [
          {
            type: "text",
            text: userFriendlyMessage,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Archive Workspace
// ============================================================================

export const archiveWorkspace = {
  name: "archive workspace",
  description: "Archive a workspace by task ID or workspace path",
  parameters: (z) => ({
    workspace_identifier: sharedParameters.workspace_identifier(z),
    has_branch_removal: z
      .boolean()
      .describe("Remove the matching worktree branch"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => {
    const { workspace_identifier, has_branch_removal } = args as {
      workspace_identifier: string;
      has_branch_removal?: boolean;
    };
    const id = workspace_identifier.trim();
    try {
      const workspace = await workspaceManager.getWorkspaceByPathOrTaskId(id);

      if (!workspace) {
        // Check if the path exists but has no metadata - archive it anyway
        if (path.isAbsolute(id) && fs.existsSync(id)) {
          // Archive workspace without metadata
          await autoCommitManager.disableAutoCommit(id);

          // Check for pending changes
          const hasPendingChanges = await gitHasPendingChanges({ cwd: id });

          let worktreeRemoved = false;
          let branchRemoved = false;
          let removalBlocked = false;
          let blockReason = "";

          // Only remove worktree if no pending changes
          if (!hasPendingChanges) {
            try {
              await gitWorktreeRemove(id);
              worktreeRemoved = true;
            } catch (error) {
              console.warn(`Failed to remove worktree via git: ${error}`);
              // If git worktree remove failed, try manual directory removal as fallback
              try {
                const fs = await import("fs");
                if (fs.existsSync(id)) {
                  console.info(
                    `Attempting manual directory removal for: ${id}`,
                  );
                  fs.rmSync(id, { recursive: true, force: true });
                  worktreeRemoved = true;
                  console.info(
                    `Successfully removed directory manually: ${id}`,
                  );
                }
              } catch (manualError) {
                console.warn(
                  `Manual directory removal also failed: ${manualError}`,
                );
                throw error; // Re-throw original error
              }
            }

            // Remove branch if requested and worktree was removed successfully
            if (has_branch_removal && worktreeRemoved) {
              try {
                const currentBranch = await gitCurrentBranch({ cwd: id });
                // Try to find the owning repository for branch deletion
                const ownerRepo = await detectWorktreeOwnerRepo(id);
                const branchCwd = ownerRepo || process.cwd();

                await gitDeleteBranch(currentBranch, false, {
                  cwd: branchCwd,
                });
                branchRemoved = true;
              } catch (error) {
                console.warn(`Failed to remove branch: ${error}`);
              }
            }
          } else {
            removalBlocked = true;
            blockReason = "pending changes detected";
          }

          const workspaceName = path.basename(id);
          const details = [
            "- Auto-commit disabled",
            "- No metadata was present (workspace archived as-is)",
          ];

          if (removalBlocked) {
            details.push(`- Worktree preserved (${blockReason})`);
            details.push("- Branch preserved");
          } else {
            details.push(
              worktreeRemoved
                ? "- Worktree removed"
                : "- Worktree preserved (removal failed)",
            );
            if (has_branch_removal) {
              details.push(
                branchRemoved
                  ? "- Branch removed"
                  : "- Branch preserved (removal failed)",
              );
            } else {
              details.push("- Branch preserved (removal not requested)");
            }
          }

          details.push(`- Path: ${id}`);

          return {
            content: [
              {
                type: "text",
                text:
                  `📦 Successfully archived workspace "${workspaceName}"\n\n` +
                  `Workspace has been safely archived. Auto-commit has been disabled.\n\n` +
                  `Details:\n${details.join("\n")}`,
              },
            ],
          };
        }
        throw new Error(`No workspace found for task/path ${id}`);
      }

      await autoCommitManager.disableAutoCommit(workspace.worktreePath);
      await workspaceManager.archiveWorkspaceByPathOrTaskId(id);

      // Check for pending changes
      const hasPendingChanges = await gitHasPendingChanges({
        cwd: workspace.worktreePath,
      });

      let worktreeRemoved = false;
      let branchRemoved = false;
      let removalBlocked = false;
      let blockReason = "";

      // Only remove worktree if no pending changes
      if (!hasPendingChanges) {
        try {
          await gitWorktreeRemove(workspace.worktreePath);
          worktreeRemoved = true;
        } catch (error) {
          console.warn(`Failed to remove worktree via git: ${error}`);
          // If git worktree remove failed, try manual directory removal as fallback
          try {
            const fs = await import("fs");
            if (fs.existsSync(workspace.worktreePath)) {
              console.info(
                `Attempting manual directory removal for: ${workspace.worktreePath}`,
              );
              fs.rmSync(workspace.worktreePath, {
                recursive: true,
                force: true,
              });
              worktreeRemoved = true;
              console.info(
                `Successfully removed directory manually: ${workspace.worktreePath}`,
              );
            }
          } catch (manualError) {
            console.warn(
              `Manual directory removal also failed: ${manualError}`,
            );
            throw error; // Re-throw original error
          }
        }

        // Remove branch if requested and worktree was removed successfully
        if (has_branch_removal && worktreeRemoved) {
          try {
            const branchName = workspace.metadata.worktree.branch;
            // Try to find the owning repository for branch deletion
            const ownerRepo = await detectWorktreeOwnerRepo(
              workspace.worktreePath,
            );
            const branchCwd = ownerRepo || process.cwd();

            await gitDeleteBranch(branchName, false, { cwd: branchCwd });
            branchRemoved = true;
          } catch (error) {
            console.warn(`Failed to remove branch: ${error}`);
          }
        }
      } else {
        removalBlocked = true;
        blockReason = "pending changes detected";
      }

      const details = [
        "- Auto-commit disabled",
        '- Workspace metadata updated to "archived" status',
      ];

      if (removalBlocked) {
        details.push(`- Worktree preserved (${blockReason})`);
        details.push("- Branch preserved");
      } else {
        details.push(
          worktreeRemoved
            ? "- Worktree removed"
            : "- Worktree preserved (removal failed)",
        );
        if (has_branch_removal) {
          details.push(
            branchRemoved
              ? "- Branch removed"
              : "- Branch preserved (removal failed)",
          );
        } else {
          details.push("- Branch preserved (removal not requested)");
        }
      }

      details.push(`- Path: ${workspace.worktreePath}`);

      return {
        content: [
          {
            type: "text",
            text:
              `📦 Successfully archived workspace "${workspace.metadata.worktree.name}" (${workspace.metadata.worktree.id})\n\n` +
              `Workspace has been safely archived. Auto-commit has been disabled and the workspace status updated.\n\n` +
              `Details:\n${details.join("\n")}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check if this is a missing metadata error
      if (errorMessage.includes("has no metadata")) {
        return createMissingMetadataResponse("archive the workspace", id);
      }

      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to archive workspace: ${errorMessage}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Launch Workspace
// ============================================================================

export const launchWorkspace = {
  name: "launch workspace",
  description: "Launch a workspace in the editor by task ID or workspace path",
  parameters: (z) => ({
    workspace_identifier: sharedParameters.workspace_identifier(z),
    git_repo_path: sharedParameters.git_repo_path_optional(z),
    editor: z
      .string()
      .optional()
      .describe("Editor to use (code, cursor, etc.). Defaults to 'cursor'"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => {
    const {
      workspace_identifier,
      git_repo_path,
      editor: editorArg,
    } = args as {
      workspace_identifier: string;
      git_repo_path?: string;
      editor?: string;
    };

    try {
      const result = await assertGitRepoPath(git_repo_path);
      if (result) {
        return result;
      }

      // Find the workspace
      const workspace =
        await workspaceManager.getWorkspaceByPathOrTaskId(workspace_identifier);

      if (!workspace) {
        return {
          content: [
            {
              type: "text",
              text: `❌ **Workspace Not Found**\n\nNo workspace found for identifier: \`${workspace_identifier}\`\n\nUse "list workspaces" to see available workspaces.`,
            },
          ],
        };
      }

      const editor = editorArg || "cursor";
      const workspacePath = workspace.worktreePath;
      const workspaceName = workspace.metadata.worktree.name;

      try {
        // Launch the editor with the workspace path
        execSync(`${editor} "${workspacePath}"`, { stdio: "ignore" });

        return {
          content: [
            {
              type: "text",
              text:
                `🚀 **Workspace Launched**\n\nSuccessfully launched workspace "${workspaceName}" in ${editor}\n\n` +
                `• **Task ID:** ${workspace.metadata.worktree.id}\n` +
                `• **Path:** ${workspacePath}\n` +
                `• **Branch:** ${workspace.metadata.worktree.branch}\n` +
                `• **Status:** ${workspace.metadata.worktree.status}`,
            },
          ],
        };
      } catch (editorError) {
        return {
          content: [
            {
              type: "text",
              text:
                `⚠️ **Editor Launch Failed**\n\nWorkspace found but failed to launch in ${editor}:\n\`${editorError instanceof Error ? editorError.message : "Unknown error"}\`\n\n` +
                `**Workspace Details:**\n` +
                `• **Name:** ${workspaceName}\n` +
                `• **Path:** ${workspacePath}\n` +
                `• **Task ID:** ${workspace.metadata.worktree.id}\n\n` +
                `Try manually opening: \`${editor} "${workspacePath}"\``,
            },
          ],
        };
      }
    } catch (error) {
      console.error(error);
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to launch workspace: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: List Workspaces
// ============================================================================

export const listWorkspaces = {
  name: "list workspaces",
  description: "List all workspaces for a git repository",
  parameters: (z) => ({
    git_repo_path: sharedParameters.git_repo_path_optional(z),
  }),
  cb: async (
    args: Record<string, unknown>,
    {}: { workspaceManager: WorkspaceManager },
  ) => {
    const { git_repo_path } = args as { git_repo_path?: string };

    try {
      const result = await assertGitRepoPath(git_repo_path);
      if (result) {
        return result;
      }

      // Use cwd if not provided
      const targetPath = git_repo_path || process.cwd();
      const workspaces =
        await WorkspaceMetadataManager.listAllWorkspaces(targetPath);

      if (workspaces.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `📋 **No Workspaces Found**\n\nNo workspaces have been created yet for \`${targetPath}\`.\n\nUse the "create workspace" tool to create your first workspace.`,
            },
          ],
        };
      }

      // Get change statistics for each workspace
      const workspaceDetails = await Promise.all(
        workspaces.map(async (workspace) => {
          const metadata = workspace.metadata;

          let diffStats = { files: 0, insertions: 0, deletions: 0 };
          let uncommittedFiles = 0;

          // Only get stats for active workspaces
          if (metadata?.worktree?.status === "active") {
            try {
              // Get current working directory changes
              const statusOutput = await gitStatus({
                cwd: workspace.worktreePath,
              });

              // Get changes since creation (diff from main branch or base)
              try {
                diffStats = await gitDiffStats("main", "HEAD", {
                  cwd: workspace.worktreePath,
                });
              } catch {
                // Fallback: try diff from origin/main if main doesn't exist locally
                try {
                  diffStats = await gitDiffStats("origin/main", "HEAD", {
                    cwd: workspace.worktreePath,
                  });
                } catch {
                  // TODO: Double fallback to check master if main fails
                  // If all else fails, get uncommitted changes only
                  diffStats = await gitDiffStats(undefined, undefined, {
                    cwd: workspace.worktreePath,
                  });
                }
              }

              // Count uncommitted changes
              uncommittedFiles = statusOutput.trim()
                ? statusOutput.trim().split("\n").length
                : 0;
            } catch (error) {
              console.warn(
                `Warning: Could not get stats for workspace ${metadata.worktree.name}: ${error}`,
              );
            }
          }

          return {
            ...workspace,
            uncommittedFiles,
            totalChanges: diffStats,
          };
        }),
      );

      const workspaceList = workspaceDetails
        .map(
          (
            { totalChanges, uncommittedFiles, metadata, worktreePath },
            index,
          ) => {
            if (!metadata) {
              return createMissingMetadataWarning(worktreePath, index);
            }
            const integrationInfo = "Workspace-only mode";

            const teamSize = metadata.team.assigned_users.length;
            const conversationCount = metadata.conversation_history.length;
            const autoCommitStatus = metadata.auto_commit.enabled
              ? "✅ Enabled"
              : "❌ Disabled";

            // Format change statistics
            const changesText =
              totalChanges.files > 0
                ? `${totalChanges.files} files (+${totalChanges.insertions}/-${totalChanges.deletions})`
                : "No changes";

            const uncommittedText =
              uncommittedFiles > 0
                ? ` • **Uncommitted:** ${uncommittedFiles} file${uncommittedFiles !== 1 ? "s" : ""}`
                : "";

            return (
              `**${index + 1}. ${metadata.worktree.name}**\n` +
              `   • **Task ID:** ${metadata.worktree.id}\n` +
              `   • **Status:** ${metadata.worktree.status}\n` +
              `   • **Branch:** ${metadata.worktree.branch}\n` +
              `   • **Changes:** ${changesText}${uncommittedText}\n` +
              `   • **Path:** ${worktreePath}\n` +
              `   • **Created:** ${new Date(metadata.worktree?.created_at ?? "").toLocaleDateString()}\n` +
              `   • **Created By:** ${metadata.worktree.created_by}\n` +
              `   • **Team Size:** ${teamSize} member${teamSize !== 1 ? "s" : ""}\n` +
              `   • **Conversations:** ${conversationCount}\n` +
              `   • **Auto-commit:** ${autoCommitStatus}\n` +
              `   • **Integration:** ${integrationInfo}\n`
            );
          },
        )
        .join("\n");

      // Calculate totals for active workspaces
      const activeWorkspaces = workspaceDetails.filter(
        (ws) => ws.metadata?.worktree?.status === "active",
      );
      const totalFiles = activeWorkspaces.reduce(
        (sum, ws) => sum + ws.totalChanges.files,
        0,
      );
      const totalInsertions = activeWorkspaces.reduce(
        (sum, ws) => sum + ws.totalChanges.insertions,
        0,
      );
      const totalDeletions = activeWorkspaces.reduce(
        (sum, ws) => sum + ws.totalChanges.deletions,
        0,
      );
      const totalUncommitted = activeWorkspaces.reduce(
        (sum, ws) => sum + ws.uncommittedFiles,
        0,
      );

      const changesSummary =
        totalFiles > 0
          ? `**Changes Summary:**\n` +
            `• Total files changed: ${totalFiles}\n` +
            `• Total insertions: +${totalInsertions}\n` +
            `• Total deletions: -${totalDeletions}\n` +
            `• Uncommitted files: ${totalUncommitted}\n\n`
          : "";

      const text =
        `📋 **All Workspaces (${workspaces.length} total)**\n\n` +
        changesSummary +
        workspaceList +
        `\n💡 Use "get workspace info" with a task ID for detailed information about a specific workspace.`;

      return {
        content: [{ type: "text", text }],
      };
    } catch (error) {
      console.error(error);
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to list workspaces: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Get Workspace Info
// ============================================================================

export const getWorkspaceInfo = {
  name: "get workspace info",
  description: "Get information about a workspace by task ID",
  parameters: (z) => ({
    task_id: z.string().describe("Task ID of the workspace"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => {
    const { task_id } = args as { task_id: string };

    try {
      const workspace = await workspaceManager.getWorkspaceByTaskId(task_id);

      if (!workspace) {
        return {
          content: [
            {
              type: "text",
              text: `❌ No workspace found for task ${task_id}`,
            },
          ],
        };
      }

      const metadata = workspace.metadata;
      const commitStatus = await autoCommitManager.getCommitQueueStatus(
        workspace.worktreePath,
      );

      return {
        content: [
          {
            type: "text",
            text:
              `📊 **Workspace Information**\n\n` +
              `**Name:** ${metadata.worktree.name}\n` +
              `**Path:** ${workspace.worktreePath}\n` +
              `**Branch:** ${metadata.worktree.branch}\n` +
              `**Base Branch:** ${metadata.git_info.base_branch}\n` +
              `**Status:** ${metadata.worktree.status}\n` +
              `**Created:** ${metadata.worktree.created_at}\n` +
              `**Created By:** ${metadata.worktree.created_by}\n` +
              `**Team Members:** ${metadata.team.assigned_users.length}\n` +
              `**Conversations:** ${metadata.conversation_history.length}\n` +
              `**Auto-commit Enabled:** ${metadata.auto_commit.enabled}\n` +
              `**Pending Changes:** ${commitStatus.pending_changes}\n` +
              `**Last Commit:** ${commitStatus.last_commit?.toISOString() || "None"}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to get workspace info: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Initialize Workspace Metadata
// ============================================================================

const DEFAULT_TASK_DESCRIPTION = "Legacy workspace";

export const initializeWorkspaceMetadata = {
  name: "initialize workspace metadata",
  description: "Initialize metadata for a workspace that doesn't have it",
  parameters: (z) => ({
    workspace_path: z
      .string()
      .describe("Absolute path to the workspace directory"),
    task_description: z
      .string()
      .default(DEFAULT_TASK_DESCRIPTION)
      .describe("Description of what this workspace was for"),
    user_id: sharedParameters.user_id(z),
  }),
  cb: async (args: Record<string, unknown>) => {
    const { workspace_path, task_description, user_id } = args as {
      workspace_path: string;
      task_description?: string;
      user_id?: string;
    };

    try {
      // Check if workspace path exists
      const fs = await import("fs");
      if (!fs.existsSync(workspace_path)) {
        throw new Error(`Workspace path does not exist: ${workspace_path}`);
      }

      // Check if metadata already exists
      try {
        const existing =
          await WorkspaceMetadataManager.loadMetadata(workspace_path);
        if (existing) {
          return {
            content: [
              {
                type: "text",
                text: `ℹ️ Workspace already has metadata: ${existing.worktree.name} (${existing.worktree.id})`,
              },
            ],
          };
        }
      } catch {
        // No metadata exists, proceed with creation
      }

      // Extract workspace name from path
      const workspaceName =
        workspace_path.split("/").pop() || "unknown-workspace";

      // Get current branch
      let currentBranch = "main";
      try {
        const status = await gitStatus({ cwd: workspace_path });
        // Extract branch from git status if possible
        const branchMatch = status.match(/On branch (.+)/);
        if (branchMatch) {
          currentBranch = branchMatch[1];
        }
      } catch {
        // Default to main if we can't determine
      }

      // Create metadata
      const metadata = await WorkspaceMetadataManager.createMetadata(
        workspace_path,
        {
          task_description: task_description || DEFAULT_TASK_DESCRIPTION,
          user_id: user_id || "unknown",
          base_branch: "main",
          worktree_name: workspaceName,
          branch: currentBranch,
        },
      );

      return {
        content: [
          {
            type: "text",
            text:
              `✅ Successfully initialized metadata for workspace "${workspaceName}"\n\n` +
              `- Task ID: ${metadata.worktree.id}\n` +
              `- Branch: ${currentBranch}\n` +
              `- Description: ${task_description || DEFAULT_TASK_DESCRIPTION}\n` +
              `- Created by: ${user_id || "unknown"}\n\n` +
              `You can now archive this workspace using its task ID or path.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to initialize workspace metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;
