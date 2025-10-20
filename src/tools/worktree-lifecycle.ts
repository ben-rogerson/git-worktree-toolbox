/**
 * Worktree Lifecycle Tools - MCP tools for worktree management:
 * create (createTaskWorktree), archive (archiveWorktree), launch (launchWorktree),
 * info (getWorktreeInfo), initialize (initializeWorktreeMetadata)
 */

import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import type { McpTool } from "@/src/tools/types";
import type { WorktreeManager } from "@/src/worktree/manager";
import {
  gitHasPendingChanges,
  gitWorktreeRemove,
  gitWorktreePrune,
  gitDeleteBranch,
  gitCurrentBranch,
  detectWorktreeOwnerRepo,
  getDefaultBranch,
} from "@/src/utils/git";

import {
  assertGitRepoPath,
  createMissingMetadataResponse,
  sharedParameters,
} from "./utils";

// ============================================================================
// Tool: Create Task Worktree
// ============================================================================

export const createTaskWorktree = {
  name: "create",
  description: "Create a new worktree with matching branch",
  cli: {
    aliases: ["new", "create"],
    flags: [
      {
        param: "task_description",
        alias: "d",
        description: "Task description",
      },
      {
        param: "base_branch",
        alias: "b",
        description: "Base branch (Optional)",
      },
      {
        param: "git_repo_path",
        alias: "p",
        description:
          "The path to the Git repo (Optional). Defaults to current repository.",
      },
    ],
  },
  cliFooter:
    "💡 Run `gwtree go <task_id>` to open the worktree in your editor\n💡 Run `gwtree changes` to see all worktrees and their changes",
  mcpFooter:
    '💡 Use the "go" tool with the task ID to open the worktree in your editor\n💡 Use the "changes" tool to see all worktrees and their current status',
  parameters: (z) => ({
    task_description: z
      .string()
      .describe("Description of the task or feature to work on"),
    git_repo_path: sharedParameters.git_repo_path_optional(z),
    base_branch: sharedParameters.base_branch_optional(z),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { task_description, base_branch, git_repo_path } = args as {
      task_description: string;
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
      const wsResult = await worktreeManager.createWorktree({
        task_description,
        base_branch,
        git_repo_path,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `✅ Worktree created successfully!\n\n` +
              `Task ID: ${wsResult.task_id}\n` +
              `Integration: Worktree-only mode\n` +
              `Worktree: ${wsResult.worktree_name}\n` +
              `Path: ${wsResult.worktree_path}\n` +
              `Metadata: ${wsResult.metadata_path}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      let userFriendlyMessage = `❌ Failed to create worktree: ${errorMessage}`;

      // Provide specific guidance for common errors
      if (errorMessage.includes("WorkTreeError")) {
        userFriendlyMessage =
          `❌ Git Worktree Error\n\n` +
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
// Tool: Archive Worktree
// ============================================================================
export const archiveWorktree = {
  name: "archive",
  description: "Archive a worktree and its matching branch",
  cli: {
    aliases: ["archive", "rm"],
    flags: [
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier",
      },
      { param: "has_branch_removal", alias: "r", description: "Remove branch" },
    ],
  },
  cliFooter:
    "💡 Run `gwtree archive <identifier> -r` to remove the branch as well\n💡 Run `gwtree list` to see all available worktrees",
  mcpFooter:
    '💡 Set "has_branch_removal: true" to remove the branch as well\n💡 Use the "list" tool to see all available worktrees',
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
    has_branch_removal: z
      .boolean()
      .describe("Remove the matching worktree branch"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier, has_branch_removal } = args as {
      worktree_identifier: string;
      has_branch_removal?: boolean;
    };

    // Validate required parameter
    if (!worktree_identifier || typeof worktree_identifier !== "string") {
      return {
        content: [
          {
            type: "text",
            text: '❌ Error: worktree_identifier is required.\n\nPlease provide a worktree identifier (task ID, name, or path).',
          },
        ],
      };
    }

    const id = worktree_identifier.trim();
    try {
      // Prune stale worktrees first
      try {
        await gitWorktreePrune();
      } catch (error) {
        console.warn(`Failed to prune worktrees: ${error}`);
      }

      const worktree = await worktreeManager.getWorktreeByPathOrTaskId(id);

      if (!worktree) {
        // Check if the path exists but has no metadata - archive it anyway
        if (path.isAbsolute(id) && fs.existsSync(id)) {
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

                if (!ownerRepo) {
                  throw new Error(
                    "Cannot detect owner repository for branch deletion",
                  );
                }

                await gitDeleteBranch(currentBranch, false, {
                  cwd: ownerRepo,
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

          const worktreeName = path.basename(id);
          const details = [
            "- No metadata was present (worktree archived as-is)",
          ];
          let statusEmoji = "✅";
          let statusMessage = "Successfully archived worktree";

          if (removalBlocked) {
            statusEmoji = "⚠️";
            statusMessage = "Archived worktree (directory preserved)";
            details.push(`- ⚠️  Worktree directory preserved (${blockReason})`);
            details.push("- Branch preserved");
          } else {
            details.push(
              worktreeRemoved
                ? "- Worktree directory removed"
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

          if (removalBlocked) {
            details.push(
              `\n💡 Tip: Commit or discard changes, then run archive again to fully remove the worktree`,
            );
          }

          return {
            content: [
              {
                type: "text",
                text:
                  `${statusEmoji} ${statusMessage} "${worktreeName}"\n\n` +
                  `Details:\n${details.join("\n")}`,
              },
            ],
          };
        }
        throw new Error(`No worktree found for task/path ${id}`);
      }

      await worktreeManager.archiveWorktreeByPathOrTaskId(id);

      // Check for pending changes
      const hasPendingChanges = await gitHasPendingChanges({
        cwd: worktree.worktreePath,
      });

      let worktreeRemoved = false;
      let branchRemoved = false;
      let removalBlocked = false;
      let blockReason = "";

      // Only remove worktree if no pending changes
      if (!hasPendingChanges) {
        try {
          await gitWorktreeRemove(worktree.worktreePath);
          worktreeRemoved = true;
        } catch (error) {
          console.warn(`Failed to remove worktree via git: ${error}`);
          // If git worktree remove failed, try manual directory removal as fallback
          try {
            const fs = await import("fs");
            if (fs.existsSync(worktree.worktreePath)) {
              console.info(
                `Attempting manual directory removal for: ${worktree.worktreePath}`,
              );
              fs.rmSync(worktree.worktreePath, {
                recursive: true,
                force: true,
              });
              worktreeRemoved = true;
              console.info(
                `Successfully removed directory manually: ${worktree.worktreePath}`,
              );
            }
          } catch (manualError) {
            console.warn(
              `Manual directory removal also failed: ${manualError}`,
            );
            throw error; // Re-throw original error
          }
        }

        // Delete metadata if worktree was removed successfully
        if (worktreeRemoved) {
          WorktreeMetadataManager.deleteMetadata(worktree.worktreePath);
        }

        // Remove branch if requested and worktree was removed successfully
        if (has_branch_removal && worktreeRemoved) {
          try {
            const branchName = worktree.metadata.worktree.branch;
            // Try to find the owning repository for branch deletion
            const ownerRepo = await detectWorktreeOwnerRepo(
              worktree.worktreePath,
            );

            if (!ownerRepo) {
              throw new Error(
                "Cannot detect owner repository for branch deletion",
              );
            }

            await gitDeleteBranch(branchName, false, { cwd: ownerRepo });
            branchRemoved = true;
          } catch (error) {
            console.warn(`Failed to remove branch: ${error}`);
          }
        }
      } else {
        removalBlocked = true;
        blockReason = "pending changes detected";
      }

      const details = ['- Worktree metadata updated to "archived" status'];
      let statusEmoji = "✅";
      let statusMessage = "Successfully archived worktree";

      if (removalBlocked) {
        statusEmoji = "⚠️";
        statusMessage = "Archived worktree metadata (worktree preserved)";
        details.push(`- ⚠️  Worktree directory preserved (${blockReason})`);
        details.push("- Branch preserved");
      } else {
        details.push(
          worktreeRemoved
            ? "- Worktree directory removed"
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

      details.push(`- Path: ${worktree.worktreePath}`);

      if (removalBlocked) {
        details.push(
          `\n💡 Tip: Commit or discard changes, then run archive again to fully remove the worktree`,
        );
      }

      return {
        content: [
          {
            type: "text",
            text:
              `${statusEmoji} ${statusMessage} "${worktree.metadata.worktree.name}" (${worktree.metadata.worktree.id})\n\n` +
              `Details:\n${details.join("\n")}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check if this is a missing metadata error
      if (errorMessage.includes("has no metadata")) {
        return createMissingMetadataResponse("archive the worktree", id);
      }

      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to archive worktree: ${errorMessage}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Clean Workspaces
// ============================================================================

export const cleanWorktrees = {
  name: "clean",
  description:
    "Archive all worktrees that don't have any changes compared to their base branch",
  cli: {
    aliases: ["clean"],
    flags: [
      {
        param: "git_repo_path",
        alias: "p",
        description: "Git repository path (optional)",
      },
      {
        param: "dry_run",
        alias: "d",
        description: "Show what would be archived without actually archiving",
      },
    ],
  },
  parameters: (z) => ({
    git_repo_path: sharedParameters.git_repo_path_optional(z),
    dry_run: z
      .boolean()
      .optional()
      .describe("Show what would be archived without actually archiving"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { git_repo_path, dry_run } = args as {
      git_repo_path?: string;
      dry_run?: boolean;
    };

    const result = await assertGitRepoPath(git_repo_path);
    if (result) {
      return result;
    }

    try {
      // Get all worktrees
      const worktrees =
        await WorktreeMetadataManager.listAllWorktrees(git_repo_path);

      if (worktrees.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No worktrees found to clean.",
            },
          ],
        };
      }

      const workspacesToArchive: Array<{
        worktreePath: string;
        metadata: any;
        reason: string;
      }> = [];
      const workspacesWithChanges: Array<{
        worktreePath: string;
        metadata: any;
        reason: string;
      }> = [];
      const errors: Array<{
        worktreePath: string;
        error: string;
      }> = [];

      // Check each worktree for changes
      const defaultBranch = await getDefaultBranch();
      for (const worktree of worktrees) {
        // First check if this is the main workspace (default branch)
        let isMainWorkspace = false;
        try {
          const currentBranch = await gitCurrentBranch({
            cwd: worktree.worktreePath,
          });
          isMainWorkspace = currentBranch === defaultBranch;
        } catch (error) {
          // If we can't determine the branch, be conservative and don't archive
          console.warn(
            `Could not determine branch for ${worktree.worktreePath}: ${error}`,
          );
        }

        if (isMainWorkspace) {
          workspacesWithChanges.push({
            worktreePath: worktree.worktreePath,
            metadata: worktree.metadata,
            reason: `main workspace (${defaultBranch} branch) - never archived`,
          });
          continue;
        }

        if (!worktree.metadata) {
          workspacesToArchive.push({
            worktreePath: worktree.worktreePath,
            metadata: null,
            reason: "no metadata",
          });
          continue;
        }

        try {
          // Check if worktree has pending changes
          const hasPendingChanges = await gitHasPendingChanges({
            cwd: worktree.worktreePath,
          });

          if (hasPendingChanges) {
            workspacesWithChanges.push({
              worktreePath: worktree.worktreePath,
              metadata: worktree.metadata,
              reason: "has uncommitted changes",
            });
            continue;
          }

          // Check if worktree has committed changes compared to base branch
          const baseBranch = worktree.metadata.git_info?.base_branch || defaultBranch;
          let hasCommittedChanges = false;

          try {
            // Try to get diff stats from base branch
            const { gitDiffStats } = await import("@/src/utils/git");
            const diffStats = await gitDiffStats(baseBranch, "HEAD", {
              cwd: worktree.worktreePath,
            });
            hasCommittedChanges = diffStats.files > 0;
          } catch (error) {
            // If diff fails, try origin/baseBranch
            try {
              const { gitDiffStats } = await import("@/src/utils/git");
              const diffStats = await gitDiffStats(
                `origin/${baseBranch}`,
                "HEAD",
                {
                  cwd: worktree.worktreePath,
                },
              );
              hasCommittedChanges = diffStats.files > 0;
            } catch (originError) {
              // If both fail, assume no changes (conservative approach)
              hasCommittedChanges = false;
            }
          }

          if (hasCommittedChanges) {
            workspacesWithChanges.push({
              worktreePath: worktree.worktreePath,
              metadata: worktree.metadata,
              reason: "has committed changes",
            });
          } else {
            workspacesToArchive.push({
              worktreePath: worktree.worktreePath,
              metadata: worktree.metadata,
              reason: "no changes compared to base branch",
            });
          }
        } catch (error) {
          errors.push({
            worktreePath: worktree.worktreePath,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Build response text
      let responseText = `🧹 Workspace Cleanup Analysis\n\n`;
      responseText += `Total worktrees found: ${worktrees.length}\n`;
      responseText += `Workspaces to archive: ${workspacesToArchive.length}\n`;
      responseText += `Workspaces with changes: ${workspacesWithChanges.length}\n`;
      responseText += `Errors: ${errors.length}\n\n`;

      if (workspacesToArchive.length > 0) {
        responseText += `📦 Workspaces to Archive:\n`;
        for (const ws of workspacesToArchive) {
          const name =
            ws.metadata?.worktree?.name || path.basename(ws.worktreePath);
          responseText += `  • ${name} - ${ws.reason}\n`;
        }
        responseText += `\n`;
      }

      if (workspacesWithChanges.length > 0) {
        responseText += `⚠️  Workspaces with Changes (preserved):\n`;
        for (const ws of workspacesWithChanges) {
          const name =
            ws.metadata?.worktree?.name || path.basename(ws.worktreePath);
          responseText += `  • ${name} - ${ws.reason}\n`;
        }
        responseText += `\n`;
      }

      if (errors.length > 0) {
        responseText += `❌ Errors:\n`;
        for (const error of errors) {
          const name = path.basename(error.worktreePath);
          responseText += `  • ${name} - ${error.error}\n`;
        }
        responseText += `\n`;
      }

      // Perform archiving if not dry run
      if (!dry_run && workspacesToArchive.length > 0) {
        responseText += `🔄 Archiving workspaces...\n\n`;

        const archiveResults: Array<{
          name: string;
          success: boolean;
          error?: string;
        }> = [];

        for (const ws of workspacesToArchive) {
          const name =
            ws.metadata?.worktree?.name || path.basename(ws.worktreePath);
          try {
            // Update metadata to archived status
            await worktreeManager.archiveWorktreeByPathOrTaskId(
              ws.worktreePath,
            );

            // Remove the worktree directory
            try {
              await gitWorktreeRemove(ws.worktreePath);
            } catch (error) {
              console.warn(`Failed to remove worktree via git: ${error}`);
              // Fallback to manual directory removal
              if (fs.existsSync(ws.worktreePath)) {
                fs.rmSync(ws.worktreePath, { recursive: true, force: true });
              }
            }

            // Delete metadata file
            if (ws.metadata) {
              WorktreeMetadataManager.deleteMetadata(ws.worktreePath);
            }

            archiveResults.push({ name, success: true });
          } catch (error) {
            archiveResults.push({
              name,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        const successful = archiveResults.filter((r) => r.success).length;
        const failed = archiveResults.filter((r) => !r.success).length;

        responseText += `✅ Successfully archived: ${successful}\n`;
        if (failed > 0) {
          responseText += `❌ Failed to archive: ${failed}\n`;
          for (const result of archiveResults.filter((r) => !r.success)) {
            responseText += `  • ${result.name} - ${result.error}\n`;
          }
        }
      } else if (dry_run) {
        responseText += `🔍 Dry run mode - no workspaces were actually archived.\n`;
        responseText += `Set dry_run to false to perform the cleanup.\n`;
      } else {
        responseText += `✨ All workspaces are clean - nothing to archive!\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to clean workspaces: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Launch Worktree
// ============================================================================

export const launchWorktree = {
  name: "go",
  description: "Open worktree in editor/terminal",
  cli: {
    aliases: ["go"],
    flags: [
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier",
      },
      {
        param: "editor",
        alias: "e",
        description: "Editor to open (code/cursor). Defaults to 'cursor'",
      },
    ],
  },
  cliFooter:
    "💡 Run `gwtree go <identifier> -e code` to open in VS Code instead\n💡 Run `gwtree list` to see all available worktrees",
  mcpFooter:
    '💡 Set "editor" parameter to "code" or "cursor" to choose your editor\n💡 Use the "list" tool to see all available worktrees',
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
    editor: z
      .string()
      .optional()
      .describe("Editor to open (code/cursor). Defaults to 'cursor'"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier, editor: editorArg } = args as {
      worktree_identifier: string;
      editor?: string;
    };

    try {
      // Find the worktree
      const worktree =
        await worktreeManager.getWorktreeByPathOrTaskId(worktree_identifier);

      if (!worktree) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Worktree Not Found\n\nNo worktree found for identifier: \`${worktree_identifier}\`\n\nUse the "list" tool to see available projects and their worktrees.`,
            },
          ],
        };
      }

      const editor = editorArg || "cursor";
      const worktreePath = worktree.worktreePath;
      const worktreeName = worktree.metadata.worktree.name;

      try {
        // Launch the editor with the worktree path
        execSync(`${editor} "${worktreePath}"`, { stdio: "ignore" });

        return {
          content: [
            {
              type: "text",
              text:
                `🚀 Worktree Launched\n\nSuccessfully launched worktree "${worktreeName}" in ${editor}\n\n` +
                `⏳ Please wait a moment for the editor to open...\n\n` +
                `• Task ID: ${worktree.metadata.worktree.id}\n` +
                `• Path: ${worktreePath}\n` +
                `• Branch: ${worktree.metadata.worktree.branch}\n` +
                `• Status: ${worktree.metadata.worktree.status}`,
            },
          ],
        };
      } catch (editorError) {
        return {
          content: [
            {
              type: "text",
              text:
                `⚠️ Editor Launch Failed\n\nWorktree found but failed to launch in ${editor}:\n\`${editorError instanceof Error ? editorError.message : "Unknown error"}\`\n\n` +
                `Worktree Details:\n` +
                `• Name: ${worktreeName}\n` +
                `• Path: ${worktreePath}\n` +
                `• Task ID: ${worktree.metadata.worktree.id}\n\n` +
                `Try manually opening: \`${editor} "${worktreePath}"\``,
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
            text: `❌ Failed to launch worktree: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

// ============================================================================
// Tool: Initialize Worktree Metadata
// ============================================================================

const DEFAULT_TASK_DESCRIPTION = "Task";

// ============================================================================
// Helper: Ensure Worktree Has Metadata
// ============================================================================

/**
 * Ensures a worktree has metadata. If missing, initializes it.
 * Called before operations that require metadata.
 */
export async function ensureWorktreeHasMetadata(
  worktreePath: string,
): Promise<void> {
  try {
    // Check if metadata exists
    const existing = await WorktreeMetadataManager.loadMetadata(worktreePath);
    if (existing) {
      return; // Metadata already exists
    }
  } catch {
    // No metadata exists, proceed with creation
  }

  // Initialize metadata
  const worktreeName = path.basename(worktreePath);

  // Get current branch and default branch
  const defaultBranch = await getDefaultBranch();
  let currentBranch = defaultBranch;
  try {
    currentBranch = await gitCurrentBranch({ cwd: worktreePath });
  } catch {
    // Default to default branch if we can't determine
  }

  await WorktreeMetadataManager.createMetadata(worktreePath, {
    task_description: DEFAULT_TASK_DESCRIPTION,
    base_branch: defaultBranch,
    worktree_name: worktreeName,
    branch: currentBranch,
  });
}

// ============================================================================
// Tool: Doctor - Check and fix worktree metadata
// ============================================================================

export const doctorWorktrees = {
  name: "doctor",
  description:
    "Check all worktrees and initialize missing metadata. Run this to ensure all worktrees have proper metadata.",
  cli: {
    aliases: ["doctor", "init"],
    flags: [
      {
        param: "git_repo_path",
        alias: "p",
        description: "The path to the Git repo (Optional).",
      },
    ],
  },
  parameters: (z) => ({
    git_repo_path: sharedParameters.git_repo_path_optional(z),
  }),
  cb: async (
    args: Record<string, unknown>,
    {}: { worktreeManager: WorktreeManager },
  ) => {
    const { git_repo_path } = args as { git_repo_path?: string };

    try {
      const result = await assertGitRepoPath(git_repo_path);
      if (result) {
        return result;
      }

      const targetPath = git_repo_path || process.cwd();
      const worktrees =
        await WorktreeMetadataManager.listAllWorktrees(targetPath);

      if (worktrees.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `📋 No Worktrees Found\n\nNo git worktrees found for \`${targetPath}\`.`,
            },
          ],
        };
      }

      const missingMetadata: Array<{ path: string; name: string }> = [];
      const existingMetadata: Array<{
        path: string;
        name: string;
        id: string;
      }> = [];

      for (const worktree of worktrees) {
        const worktreeName = path.basename(worktree.worktreePath);

        if (!worktree.metadata) {
          missingMetadata.push({
            path: worktree.worktreePath,
            name: worktreeName,
          });
        } else {
          existingMetadata.push({
            path: worktree.worktreePath,
            name: worktreeName,
            id: worktree.metadata.worktree.id,
          });
        }
      }

      // Initialize metadata for worktrees that don't have it
      const initialized: Array<{ name: string; id: string }> = [];

      for (const missing of missingMetadata) {
        try {
          // Get current branch and default branch
          const defaultBranch = await getDefaultBranch();
          let currentBranch = defaultBranch;
          try {
            currentBranch = await gitCurrentBranch({ cwd: missing.path });
          } catch {
            // Default to default branch if we can't determine
          }

          const metadata = await WorktreeMetadataManager.createMetadata(
            missing.path,
            {
              task_description: DEFAULT_TASK_DESCRIPTION,
              base_branch: defaultBranch,
              worktree_name: missing.name,
              branch: currentBranch,
            },
          );

          initialized.push({
            name: missing.name,
            id: metadata.worktree.id,
          });
        } catch (error) {
          console.error(`Failed to initialize ${missing.name}:`, error);
        }
      }

      const summary: string[] = [
        `📊 Worktree Health Check Complete\n`,
        `Total worktrees: ${worktrees.length}`,
        `Already tracked: ${existingMetadata.length}`,
        `Missing metadata: ${missingMetadata.length}`,
        `Newly initialized: ${initialized.length}`,
      ];

      if (initialized.length > 0) {
        summary.push(
          `\nInitialized worktrees:`,
          ...initialized.map((w) => `  • ${w.name} (${w.id})`),
        );
      }

      if (missingMetadata.length > initialized.length) {
        const failed = missingMetadata.length - initialized.length;
        summary.push(
          `\n⚠️ Failed to initialize: ${failed} worktree${failed !== 1 ? "s" : ""}`,
        );
      }

      if (existingMetadata.length > 0) {
        summary.push(
          `\nExisting worktrees:`,
          ...existingMetadata.map((w) => `  • ${w.name} (${w.id})`),
        );
      }

      return {
        content: [
          {
            type: "text",
            text: summary.join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to run doctor: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;
