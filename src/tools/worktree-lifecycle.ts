/**
 * Worktree Lifecycle Tools - MCP tools for worktree management:
 * create (createTaskWorktree), archive (archiveWorktree), launch (launchWorktree),
 * info (getWorktreeInfo), initialize (initializeWorktreeMetadata)
 */

import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { autoCommitManager } from "@/src/worktree/auto-commit";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import type { McpTool } from "@/src/tools/types";
import type { WorktreeManager } from "@/src/worktree/manager";
import {
  gitHasPendingChanges,
  gitWorktreeRemove,
  gitDeleteBranch,
  gitCurrentBranch,
  detectWorktreeOwnerRepo,
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
  aliases: ["new", "create"],
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
    { worktreeManager }: { worktreeManager: WorktreeManager },
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
      const wsResult = await worktreeManager.createWorktree({
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
              `✅ Worktree created successfully!\n\n` +
              `**Task ID:** ${wsResult.task_id}\n` +
              `**Integration:** Worktree-only mode\n` +
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
      let userFriendlyMessage = `❌ Failed to create worktree: ${errorMessage}`;

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
// Tool: Archive Worktree
// ============================================================================
export const archiveWorktree = {
  name: "archive",
  description: "Archive a worktree and its matching branch",
  aliases: ["archive"],
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
    const id = worktree_identifier.trim();
    try {
      const worktree = await worktreeManager.getWorktreeByPathOrTaskId(id);

      if (!worktree) {
        // Check if the path exists but has no metadata - archive it anyway
        if (path.isAbsolute(id) && fs.existsSync(id)) {
          // Archive worktree without metadata
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

          const worktreeName = path.basename(id);
          const details = [
            "- Auto-commit disabled",
            "- No metadata was present (worktree archived as-is)",
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
                  `📦 Successfully archived worktree "${worktreeName}"\n\n` +
                  `Worktree has been safely archived. Auto-commit has been disabled.\n\n` +
                  `Details:\n${details.join("\n")}`,
              },
            ],
          };
        }
        throw new Error(`No worktree found for task/path ${id}`);
      }

      await autoCommitManager.disableAutoCommit(worktree.worktreePath);
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
        '- Worktree metadata updated to "archived" status',
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

      details.push(`- Path: ${worktree.worktreePath}`);

      return {
        content: [
          {
            type: "text",
            text:
              `📦 Successfully archived worktree "${worktree.metadata.worktree.name}" (${worktree.metadata.worktree.id})\n\n` +
              `Worktree has been safely archived. Auto-commit has been disabled and the worktree status updated.\n\n` +
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
// Tool: Launch Worktree
// ============================================================================

export const launchWorktree = {
  name: "go",
  description: "Open worktree in editor/terminal",
  aliases: ["go"],
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
    git_repo_path: sharedParameters.git_repo_path_optional(z),
    editor: z
      .string()
      .optional()
      .describe("Editor to use (code, cursor, etc.). Defaults to 'cursor'"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const {
      worktree_identifier,
      git_repo_path,
      editor: editorArg,
    } = args as {
      worktree_identifier: string;
      git_repo_path?: string;
      editor?: string;
    };

    try {
      const result = await assertGitRepoPath(git_repo_path);
      if (result) {
        return result;
      }

      // Find the worktree
      const worktree =
        await worktreeManager.getWorktreeByPathOrTaskId(worktree_identifier);

      if (!worktree) {
        return {
          content: [
            {
              type: "text",
              text: `❌ **Worktree Not Found**\n\nNo worktree found for identifier: \`${worktree_identifier}\`\n\nUse "list worktrees" to see available worktrees.`,
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
                `🚀 **Worktree Launched**\n\nSuccessfully launched worktree "${worktreeName}" in ${editor}\n\n` +
                `• **Task ID:** ${worktree.metadata.worktree.id}\n` +
                `• **Path:** ${worktreePath}\n` +
                `• **Branch:** ${worktree.metadata.worktree.branch}\n` +
                `• **Status:** ${worktree.metadata.worktree.status}`,
            },
          ],
        };
      } catch (editorError) {
        return {
          content: [
            {
              type: "text",
              text:
                `⚠️ **Editor Launch Failed**\n\nWorktree found but failed to launch in ${editor}:\n\`${editorError instanceof Error ? editorError.message : "Unknown error"}\`\n\n` +
                `**Worktree Details:**\n` +
                `• **Name:** ${worktreeName}\n` +
                `• **Path:** ${worktreePath}\n` +
                `• **Task ID:** ${worktree.metadata.worktree.id}\n\n` +
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
// Tool: List Worktrees (deprecated in favor of list projects)
// ============================================================================

// export const listWorktrees = {
//   name: "list worktrees",
//   description: "List all worktrees for a git repository",
//   parameters: (z) => ({
//     git_repo_path: sharedParameters.git_repo_path_optional(z),
//   }),
//   cb: async (
//     args: Record<string, unknown>,
//     {}: { worktreeManager: WorktreeManager },
//   ) => {
//     const { git_repo_path } = args as { git_repo_path?: string };

//     try {
//       const result = await assertGitRepoPath(git_repo_path);
//       if (result) {
//         return result;
//       }

//       // Use cwd if not provided
//       const targetPath = git_repo_path || process.cwd();
//       const worktrees =
//         await WorktreeMetadataManager.listAllWorktrees(targetPath);

//       if (worktrees.length === 0) {
//         return {
//           content: [
//             {
//               type: "text",
//               text: `📋 **No Worktrees Found**\n\nNo worktrees have been created yet for \`${targetPath}\`.\n\nUse the "create worktree" tool to create your first worktree.`,
//             },
//           ],
//         };
//       }

//       // Get change statistics for each worktree
//       const worktreeDetails = await Promise.all(
//         worktrees.map(async (worktree) => {
//           const metadata = worktree.metadata;

//           let diffStats = { files: 0, insertions: 0, deletions: 0 };
//           let uncommittedFiles = 0;

//           // Only get stats for active worktrees
//           if (metadata?.worktree?.status === "active") {
//             try {
//               // Get current working directory changes
//               const statusOutput = await gitStatus({
//                 cwd: worktree.worktreePath,
//               });

//               // Get changes since creation (diff from main branch or base)
//               try {
//                 diffStats = await gitDiffStats("main", "HEAD", {
//                   cwd: worktree.worktreePath,
//                 });
//               } catch {
//                 // Fallback: try diff from origin/main if main doesn't exist locally
//                 try {
//                   diffStats = await gitDiffStats("origin/main", "HEAD", {
//                     cwd: worktree.worktreePath,
//                   });
//                 } catch {
//                   // TODO: Double fallback to check master if main fails
//                   // If all else fails, get uncommitted changes only
//                   diffStats = await gitDiffStats(undefined, undefined, {
//                     cwd: worktree.worktreePath,
//                   });
//                 }
//               }

//               // Count uncommitted changes
//               uncommittedFiles = statusOutput.trim()
//                 ? statusOutput.trim().split("\n").length
//                 : 0;
//             } catch (error) {
//               console.warn(
//                 `Warning: Could not get stats for worktree ${metadata.worktree.name}: ${error}`,
//               );
//             }
//           }

//           return {
//             ...worktree,
//             uncommittedFiles,
//             totalChanges: diffStats,
//           };
//         }),
//       );

//       const worktreeList = worktreeDetails
//         .map(
//           (
//             { totalChanges, uncommittedFiles, metadata, worktreePath },
//             index,
//           ) => {
//             if (!metadata) {
//               return createMissingMetadataWarning(worktreePath, index);
//             }
//             const integrationInfo = "Worktree-only mode";

//             const teamSize = metadata.team.assigned_users.length;
//             const conversationCount = metadata.conversation_history.length;
//             const autoCommitStatus = metadata.auto_commit.enabled
//               ? "✅ Enabled"
//               : "❌ Disabled";

//             // Format change statistics
//             const changesText =
//               totalChanges.files > 0
//                 ? `${totalChanges.files} files (+${totalChanges.insertions}/-${totalChanges.deletions})`
//                 : "No changes";

//             const uncommittedText =
//               uncommittedFiles > 0
//                 ? ` • **Uncommitted:** ${uncommittedFiles} file${uncommittedFiles !== 1 ? "s" : ""}`
//                 : "";

//             return (
//               `**${index + 1}. ${metadata.worktree.name}**\n` +
//               `   • **Task ID:** ${metadata.worktree.id}\n` +
//               `   • **Status:** ${metadata.worktree.status}\n` +
//               `   • **Branch:** ${metadata.worktree.branch}\n` +
//               `   • **Changes:** ${changesText}${uncommittedText}\n` +
//               `   • **Path:** ${worktreePath}\n` +
//               `   • **Created:** ${new Date(metadata.worktree?.created_at ?? "").toLocaleDateString()}\n` +
//               `   • **Created By:** ${metadata.worktree.created_by}\n` +
//               `   • **Team Size:** ${teamSize} member${teamSize !== 1 ? "s" : ""}\n` +
//               `   • **Conversations:** ${conversationCount}\n` +
//               `   • **Auto-commit:** ${autoCommitStatus}\n` +
//               `   • **Integration:** ${integrationInfo}\n`
//             );
//           },
//         )
//         .join("\n");

//       // Calculate totals for active worktrees
//       const activeWorktrees = worktreeDetails.filter(
//         (ws) => ws.metadata?.worktree?.status === "active",
//       );
//       const totalFiles = activeWorktrees.reduce(
//         (sum, ws) => sum + ws.totalChanges.files,
//         0,
//       );
//       const totalInsertions = activeWorktrees.reduce(
//         (sum, ws) => sum + ws.totalChanges.insertions,
//         0,
//       );
//       const totalDeletions = activeWorktrees.reduce(
//         (sum, ws) => sum + ws.totalChanges.deletions,
//         0,
//       );
//       const totalUncommitted = activeWorktrees.reduce(
//         (sum, ws) => sum + ws.uncommittedFiles,
//         0,
//       );

//       const changesSummary =
//         totalFiles > 0
//           ? `**Changes Summary:**\n` +
//             `• Total files changed: ${totalFiles}\n` +
//             `• Total insertions: +${totalInsertions}\n` +
//             `• Total deletions: -${totalDeletions}\n` +
//             `• Uncommitted files: ${totalUncommitted}\n\n`
//           : "";

//       const text =
//         `📋 **All Worktrees (${worktrees.length} total)**\n\n` +
//         changesSummary +
//         worktreeList +
//         `\n💡 Use "get worktree info" with a task ID for detailed information about a specific worktree.`;

//       return {
//         content: [{ type: "text", text }],
//       };
//     } catch (error) {
//       console.error(error);
//       return {
//         content: [
//           {
//             type: "text",
//             text: `❌ Failed to list worktrees: ${error instanceof Error ? error.message : "Unknown error"}`,
//           },
//         ],
//       };
//     }
//   },
// } satisfies McpTool;

// ============================================================================
// Tool: Get Worktree Info
// ============================================================================

export const getWorktreeInfo = {
  name: "info",
  description: "Get worktree information",
  aliases: ["info"],
  parameters: (z) => ({
    task_id: z.string().describe("Task ID of the worktree"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { task_id } = args as { task_id: string };

    try {
      const worktree = await worktreeManager.getWorktreeByTaskId(task_id);

      if (!worktree) {
        return {
          content: [
            {
              type: "text",
              text: `❌ No worktree found for task ${task_id}`,
            },
          ],
        };
      }

      const metadata = worktree.metadata;
      const commitStatus = await autoCommitManager.getCommitQueueStatus(
        worktree.worktreePath,
      );

      return {
        content: [
          {
            type: "text",
            text:
              `📊 **Worktree Information**\n\n` +
              `**Name:** ${metadata.worktree.name}\n` +
              `**Path:** ${worktree.worktreePath}\n` +
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
            text: `❌ Failed to get worktree info: ${error instanceof Error ? error.message : "Unknown error"}`,
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

// export const initializeWorktreeMetadata = {
//   name: "initialize",
//   description: "Initialize metadata for an existing worktree",
//   aliases: ["init"],
//   parameters: (z) => ({
//     worktree_path: z
//       .string()
//       .describe("Absolute path to the worktree directory"),
//     task_description: z
//       .string()
//       .default(DEFAULT_TASK_DESCRIPTION)
//       .describe("Short task description"),
//     user_id: sharedParameters.user_id(z),
//   }),
//   cb: async (args: Record<string, unknown>) => {
//     const { worktree_path, task_description, user_id } = args as {
//       worktree_path: string;
//       task_description?: string;
//       user_id?: string;
//     };

//     try {
//       // Check if worktree path exists
//       const fs = await import("fs");
//       if (!fs.existsSync(worktree_path)) {
//         throw new Error(`Worktree path does not exist: ${worktree_path}`);
//       }

//       // Check if metadata already exists
//       try {
//         const existing =
//           await WorktreeMetadataManager.loadMetadata(worktree_path);
//         if (existing) {
//           return {
//             content: [
//               {
//                 type: "text",
//                 text: `ℹ️ Worktree already has metadata: ${existing.worktree.name} (${existing.worktree.id})`,
//               },
//             ],
//           };
//         }
//       } catch {
//         // No metadata exists, proceed with creation
//       }

//       // Extract worktree name from path
//       const worktreeName = worktree_path.split("/").pop() || "unknown-worktree";

//       // Get current branch
//       let currentBranch = "main";
//       try {
//         const status = await gitStatus({ cwd: worktree_path });
//         // Extract branch from git status if possible
//         const branchMatch = status.match(/On branch (.+)/);
//         if (branchMatch) {
//           currentBranch = branchMatch[1];
//         }
//       } catch {
//         // Default to main if we can't determine
//       }

//       // Create metadata
//       const metadata = await WorktreeMetadataManager.createMetadata(
//         worktree_path,
//         {
//           task_description: task_description || DEFAULT_TASK_DESCRIPTION,
//           user_id: user_id || "unknown",
//           base_branch: "main",
//           worktree_name: worktreeName,
//           branch: currentBranch,
//         },
//       );

//       return {
//         content: [
//           {
//             type: "text",
//             text:
//               `✅ Successfully initialized metadata for worktree "${worktreeName}"\n\n` +
//               `- Task ID: ${metadata.worktree.id}\n` +
//               `- Branch: ${currentBranch}\n` +
//               `- Description: ${task_description || DEFAULT_TASK_DESCRIPTION}\n` +
//               `- Created by: ${user_id || "unknown"}\n\n` +
//               `You can now archive this worktree using its task ID or path.`,
//           },
//         ],
//       };
//     } catch (error) {
//       return {
//         content: [
//           {
//             type: "text",
//             text: `❌ Failed to initialize worktree metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
//           },
//         ],
//       };
//     }
//   },
// } satisfies McpTool;

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

  // Get current branch
  let currentBranch = "main";
  try {
    currentBranch = await gitCurrentBranch({ cwd: worktreePath });
  } catch {
    // Default to main if we can't determine
  }

  await WorktreeMetadataManager.createMetadata(worktreePath, {
    task_description: DEFAULT_TASK_DESCRIPTION,
    user_id: "system",
    base_branch: "main",
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
  aliases: ["doctor"],
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
              text: `📋 **No Worktrees Found**\n\nNo git worktrees found for \`${targetPath}\`.`,
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
          // Get current branch
          let currentBranch = "main";
          try {
            currentBranch = await gitCurrentBranch({ cwd: missing.path });
          } catch {
            // Default to main if we can't determine
          }

          const metadata = await WorktreeMetadataManager.createMetadata(
            missing.path,
            {
              task_description: DEFAULT_TASK_DESCRIPTION,
              user_id: "system",
              base_branch: "main",
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
        `📊 **Worktree Health Check Complete**\n`,
        `**Total worktrees:** ${worktrees.length}`,
        `**Already tracked:** ${existingMetadata.length}`,
        `**Missing metadata:** ${missingMetadata.length}`,
        `**Newly initialized:** ${initialized.length}`,
      ];

      if (initialized.length > 0) {
        summary.push(
          `\n**Initialized worktrees:**`,
          ...initialized.map((w) => `  • ${w.name} (${w.id})`),
        );
      }

      if (missingMetadata.length > initialized.length) {
        const failed = missingMetadata.length - initialized.length;
        summary.push(
          `\n⚠️ **Failed to initialize:** ${failed} worktree${failed !== 1 ? "s" : ""}`,
        );
      }

      if (existingMetadata.length > 0) {
        summary.push(
          `\n**Existing worktrees:**`,
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
