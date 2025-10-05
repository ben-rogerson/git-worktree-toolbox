// Worktree Changes Tools - MCP tools for change management: list changes (listChangesFromSpecificWorktree), force commit (forceCommitWorktree), merge remote changes (mergeRemoteWorktreeChangesIntoLocal)

import { WorktreeManager } from "@/src/worktree/manager";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import { autoCommitManager } from "@/src/worktree/auto-commit";
import type { McpTool } from "@/src/tools/types";
import {
  gitStatus,
  gitCurrentBranch,
  gitDiffStats,
  gitMergeDryRun,
  gitCheckoutFiles,
  executeGitCommand,
  gitDiffFileList,
} from "@/src/utils/git";
import { listWorkTrees } from "@/src/worktree/git-operations";
import { assertWorktreeName, sharedParameters } from "./utils";

export const listChangesFromSpecificWorktree = {
  name: "changes",
  description: "Show all the changes in a worktree",
  aliases: ["changes"],
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier } = args as { worktree_identifier: string };

    try {
      const worktree =
        await worktreeManager.getWorktreeByPathOrTaskId(worktree_identifier);

      if (!worktree) {
        // List available worktrees for better error message
        const worktrees = await WorktreeMetadataManager.listAllWorktrees();
        return {
          content: [
            {
              type: "text",
              text: `❌ Worktree '${worktree_identifier}' not found.\n\nAvailable worktrees:\n${worktrees
                .map((ws) => {
                  if (ws.metadata) {
                    return `• ${ws.metadata.worktree.name} (${ws.metadata.worktree.id})`;
                  } else {
                    // Fallback to path-based identifier for worktrees without metadata
                    const pathParts = ws.worktreePath.split("/");
                    const folderName = pathParts[pathParts.length - 1];
                    return `• ${folderName} (no metadata) - ${ws.worktreePath}`;
                  }
                })
                .join("\n")}`,
            },
          ],
        };
      }

      const metadata = worktree.metadata;
      const targetWorktreePath = worktree.worktreePath;

      // Get git status for uncommitted changes
      let statusOutput = "";
      let uncommittedChanges: Array<{
        file: string;
        status: string;
        type: "staged" | "unstaged";
      }> = [];

      try {
        statusOutput = await gitStatus({
          cwd: targetWorktreePath,
        });

        if (statusOutput.trim()) {
          uncommittedChanges = statusOutput
            .trim()
            .split("\n")
            .map((line) => {
              const status = line.slice(0, 2);
              const file = line.slice(3);
              const type: "staged" | "unstaged" =
                status[0] !== " " ? "staged" : "unstaged";

              let statusText = "unknown";
              if (status.includes("M")) statusText = "modified";
              else if (status.includes("A")) statusText = "added";
              else if (status.includes("D")) statusText = "deleted";
              else if (status.includes("R")) statusText = "renamed";
              else if (status.includes("C")) statusText = "copied";
              else if (status.includes("??")) statusText = "untracked";

              return { file, status: statusText, type };
            });
        }
      } catch (error) {
        console.warn(
          `Warning: Could not get git status for ${targetWorktreePath}: ${error}`,
        );
      }

      // Get diff stats for committed changes
      let diffStats = { files: 0, insertions: 0, deletions: 0 };
      try {
        // Try diff from main branch first
        diffStats = await gitDiffStats("main", "HEAD", {
          cwd: targetWorktreePath,
        });
      } catch {
        try {
          // Fallback: try diff from origin/main
          diffStats = await gitDiffStats("origin/main", "HEAD", {
            cwd: targetWorktreePath,
          });
        } catch {
          // If all else fails, get uncommitted changes only
          try {
            diffStats = await gitDiffStats(undefined, undefined, {
              cwd: targetWorktreePath,
            });
          } catch {
            // No diff stats available
          }
        }
      }

      // Get current branch
      let currentBranch = "unknown";
      try {
        currentBranch = await gitCurrentBranch({
          cwd: targetWorktreePath,
        });
      } catch (error) {
        console.warn(`Warning: Could not get current branch: ${error}`);
      }

      // Format uncommitted changes
      const uncommittedText =
        uncommittedChanges.length > 0
          ? uncommittedChanges
              .map(
                (change) =>
                  `     • ${change.file} (${change.status}${change.type === "staged" ? " - staged" : ""})`,
              )
              .join("\n")
          : "No uncommitted changes";

      // Format committed changes
      const committedText =
        diffStats.files > 0
          ? `${diffStats.files} files (+${diffStats.insertions}/-${diffStats.deletions})`
          : "No committed changes";

      const integrationInfo = "Worktree-only mode";

      const teamSize = metadata.team.assigned_users.length;
      const conversationCount = metadata.conversation_history.length;
      const autoCommitStatus = metadata.auto_commit.enabled
        ? "✅ Enabled"
        : "❌ Disabled";

      return {
        content: [
          {
            type: "text",
            text:
              `📊 **Worktree Changes: ${metadata.worktree.name}**\n\n` +
              `**Basic Info:**\n` +
              `• **Task ID:** ${metadata.worktree.id}\n` +
              `• **Status:** ${metadata.worktree.status}\n` +
              `• **Branch:** ${currentBranch}\n` +
              `• **Path:** ${targetWorktreePath}\n` +
              `• **Created:** ${new Date(metadata.worktree?.created_at ?? "").toLocaleDateString()}\n` +
              `• **Created By:** ${metadata.worktree.created_by}\n` +
              `• **Team Size:** ${teamSize} member${teamSize !== 1 ? "s" : ""}\n` +
              `• **Conversations:** ${conversationCount}\n` +
              `• **Auto-commit:** ${autoCommitStatus}\n` +
              `• **Integration:** ${integrationInfo}\n\n` +
              `**Git Changes:**\n` +
              `• **Committed Changes:** ${committedText}\n` +
              `• **Uncommitted Changes:** ${uncommittedChanges.length} file${uncommittedChanges.length !== 1 ? "s" : ""}\n\n` +
              `**Uncommitted Files:**\n${uncommittedText}\n\n` +
              `💡 Use "force commit worktree" with task ID ${metadata.worktree.id} to commit pending changes.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to get worktree changes: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

export const forceCommitWorktree = {
  name: "push",
  description: "Commit and push all changes",
  aliases: ["push"],
  parameters: (z) => ({
    task_id: sharedParameters.task_id(z),
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

      await autoCommitManager.forceCommit(worktree.worktreePath);

      return {
        content: [
          {
            type: "text",
            text:
              `✅ Force commit completed for worktree\n\n` +
              `All pending changes have been committed and pushed.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to force commit: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

export const mergeRemoteWorktreeChangesIntoLocal = {
  name: "grab",
  description:
    "Merge all changes from another worktree into the current worktree",
  aliases: ["grab"],
  parameters: (z) => ({
    worktree_name: sharedParameters.worktree_name(z),
    git_repo_path: sharedParameters.git_repo_path_optional(z),
    avoid_dry_run: z.boolean().optional().describe("Avoid dry run"),
  }),
  cb: async (
    args: Record<string, unknown>,
    {}: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_name, git_repo_path, avoid_dry_run } = args as {
      worktree_name: string;
      git_repo_path?: string;
      avoid_dry_run?: boolean;
    };

    const targetPath = git_repo_path || process.cwd();
    const workTrees = await listWorkTrees(targetPath);
    const worktreeNameError = await assertWorktreeName(
      workTrees,
      worktree_name,
    );
    if (worktreeNameError) {
      return worktreeNameError;
    }

    const targetWorkTree = workTrees.find((wt) => wt.name === worktree_name)!;

    const dryRun = !Boolean(avoid_dry_run);

    try {
      const gitOptions = { cwd: targetPath };

      // Get current branch
      const currentBranch = await gitCurrentBranch(gitOptions);

      // Check if we're already on the target branch
      if (currentBranch === targetWorkTree.branch) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Cannot bring changes from worktree '${worktree_name}' because you are already on branch '${targetWorkTree.branch}'.\n\nSwitch to a different branch first.`,
            },
          ],
        };
      }

      // Check if target branch exists
      try {
        await executeGitCommand(
          `git rev-parse --verify "${targetWorkTree.branch}"`,
          gitOptions,
        );
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Branch '${targetWorkTree.branch}' does not exist or is not accessible.`,
            },
          ],
        };
      }

      // Perform dry run merge check
      const dryRunResult = await gitMergeDryRun(
        targetWorkTree.branch,
        gitOptions,
      );

      if (dryRunResult.conflicts) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `❌ **Merge Conflicts Detected**\n\n` +
                `Cannot bring changes from worktree '${worktree_name}' (${targetWorkTree.branch}) due to conflicts:\n\n` +
                `**Conflicting files:**\n${dryRunResult.conflictFiles.map((file) => `• ${file}`).join("\n")}\n\n` +
                `**Resolution options:**\n` +
                `• Manually resolve conflicts in the target worktree\n` +
                `• Use selective cherry-picking instead\n` +
                `• Rebase the target branch`,
            },
          ],
        };
      }

      if (dryRun) {
        // Get list of files that would be changed
        let changedFiles: string[] = [];
        try {
          changedFiles = await gitDiffFileList(
            currentBranch,
            targetWorkTree.branch,
            gitOptions,
          );
        } catch (error) {
          console.warn(`Warning: Could not get file list: ${error}`);
        }

        const filesText =
          changedFiles.length > 0
            ? `\n\n**Files to be changed (${changedFiles.length}):**\n${changedFiles.map((file) => `• ${file}`).join("\n")}`
            : "\n\n**No files to change.**";

        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ **Dry Run Successful**\n\n` +
                `Files from worktree '${worktree_name}' (${targetWorkTree.branch}) can be safely copied to '${currentBranch}'.\n\n` +
                `**Copy details:**\n` +
                `• Source: ${targetWorkTree.branch}\n` +
                `• Target: ${currentBranch}\n` +
                `• No conflicts detected` +
                filesText +
                `\n\nRun with \`dry_run: false\` to copy the files (no history preserved).`,
            },
          ],
        };
      }

      // Get list of files that will be changed before checkout
      let changedFiles: string[] = [];
      try {
        changedFiles = await gitDiffFileList(
          currentBranch,
          targetWorkTree.branch,
          gitOptions,
        );
      } catch (error) {
        console.warn(`Warning: Could not get file list: ${error}`);
      }

      // Copy files from target branch using git checkout
      try {
        await gitCheckoutFiles(targetWorkTree.branch, gitOptions);

        const filesText =
          changedFiles.length > 0
            ? `\n\n**Files changed (${changedFiles.length}):**\n${changedFiles.map((file) => `• ${file}`).join("\n")}`
            : "\n\n**No files were changed.**";

        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ **Files Copied Successfully**\n\n` +
                `All files from worktree '${worktree_name}' (${targetWorkTree.branch}) have been copied to '${currentBranch}'.\n\n` +
                `**Operation:** File copy (no history preserved)\n` +
                `**Source:** ${targetWorkTree.branch}\n` +
                `**Target:** ${currentBranch}` +
                filesText +
                `\n\nThe files are now in your working directory. Review and commit as needed.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Failed to copy files: ${error instanceof Error ? error.message : "Unknown error"}\n\nCheck that the target branch exists and is accessible.`,
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Failed to bring worktree changes: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;
