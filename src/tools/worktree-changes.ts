// Worktree Changes Tools - MCP tools for change management: list changes (listChangesFromSpecificWorktree), force commit (forceCommitWorktree), merge remote changes (mergeRemoteWorktreeChangesIntoLocal)

import { WorktreeManager } from "@/src/worktree/manager";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import type { McpTool } from "@/src/tools/types";
import {
  gitStatus,
  gitCurrentBranch,
  gitDiffStats,
  gitMergeDryRun,
  gitCheckoutFiles,
  executeGitCommand,
  gitDiffFileList,
  detectWorktreeOwnerRepo,
  getDefaultBranch,
  gitAdd,
  gitCommit,
  gitPush,
} from "@/src/utils/git";
import { sharedParameters, getGitRepositoryPath } from "./utils";

export const worktreeChanges = {
  name: "changes",
  description:
    "Show all changes in a worktree or current repo. Optionally commit and push changes.",
  cli: {
    aliases: ["changes"],
    flags: [
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier",
      },
      {
        param: "push_changes",
        alias: "p",
        description: "Push any pending changes",
      },
    ],
  },
  cliFooter:
    "💡 Try asking the MCP: 'Show changes from task-245' or 'What files have I modified?'\n💡 Run `gwtree changes <identifier>` to see detailed changes for a specific worktree\n💡 Run `gwtree changes -p` to commit and push all pending changes",
  mcpFooter:
    '💡 Use "worktree_identifier" parameter to see detailed changes for a specific worktree\n💡 Set "push_changes: true" to commit and push all pending changes',
  parameters: (z) => ({
    worktree_identifier: z
      .string()
      .optional()
      .describe("Worktree path or task ID. Defaults to current directory."),
    push_changes: z
      .boolean()
      .optional()
      .describe("Commit and push all changes"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier, push_changes } = args as {
      worktree_identifier?: string;
      push_changes?: boolean;
    };

    try {
      // If no identifier provided, show all worktrees
      if (!worktree_identifier) {
        const cwd = await getGitRepositoryPath();
        if (!cwd) {
          return {
            content: [
              {
                type: "text",
                text: "❌ No git repository found in current directory or parent directories.\n\nNavigate to a git repository first.",
              },
            ],
          };
        }
        const worktrees = await WorktreeMetadataManager.listAllWorktrees(cwd);

        if (worktrees.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No worktrees found in the current repository.",
              },
            ],
          };
        }

        // Auto-initialize metadata for worktrees that don't have it
        const worktreesWithoutMetadata = worktrees.filter((wt) => !wt.metadata);
        if (worktreesWithoutMetadata.length > 0) {
          const { ensureWorktreeHasMetadata } = await import(
            "./worktree-lifecycle"
          );
          await WorktreeMetadataManager.ensureMetadataForWorktrees(
            worktreesWithoutMetadata.map((wt) => wt.worktreePath),
            ensureWorktreeHasMetadata,
          );
          // Reload worktrees with newly created metadata
          const reloadedWorktrees =
            await WorktreeMetadataManager.listAllWorktrees(cwd);
          worktrees.length = 0;
          worktrees.push(...reloadedWorktrees);
        }

        // Identify main worktree by checking current branch
        const defaultBranch = await getDefaultBranch();
        let mainWorktreePath: string | undefined;
        for (const wt of worktrees) {
          try {
            const branch = await gitCurrentBranch({ cwd: wt.worktreePath });
            if (branch === defaultBranch) {
              mainWorktreePath = wt.worktreePath;
              break;
            }
          } catch {
            // Ignore errors
          }
        }

        // Filter to only active worktrees
        const activeWorktrees = worktrees.filter(
          (wt) => !wt.metadata || wt.metadata.worktree.status === "active",
        );

        // Collect changes for each worktree
        const worktreeChanges = await Promise.all(
          activeWorktrees.map(async (wt) => {
            const targetWorktreePath = wt.worktreePath;
            const metadata = wt.metadata;
            const isMainTree = targetWorktreePath === mainWorktreePath;
            const isCwd = targetWorktreePath === cwd;

            if (!metadata) {
              return {
                name: targetWorktreePath.split("/").pop() || "unknown",
                path: targetWorktreePath,
                error: "No metadata",
                isMainTree,
                isCwd,
              };
            }

            // Get uncommitted changes count
            let uncommittedCount = 0;
            try {
              const statusOutput = await gitStatus({
                cwd: targetWorktreePath,
              });
              if (statusOutput.trim()) {
                uncommittedCount = statusOutput.trim().split("\n").length;
              }
            } catch {
              // Ignore errors
            }

            // Get diff stats for committed changes
            let diffStats = { files: 0, insertions: 0, deletions: 0 };
            try {
              diffStats = await gitDiffStats(defaultBranch, "HEAD", {
                cwd: targetWorktreePath,
              });
            } catch {
              try {
                diffStats = await gitDiffStats(
                  `origin/${defaultBranch}`,
                  "HEAD",
                  {
                    cwd: targetWorktreePath,
                  },
                );
              } catch {
                // No diff stats available
              }
            }

            // Get current branch
            let currentBranch = "unknown";
            try {
              currentBranch = await gitCurrentBranch({
                cwd: targetWorktreePath,
              });
            } catch {
              // Ignore errors
            }

            return {
              name: metadata.worktree.name,
              id: metadata.worktree.id,
              branch: currentBranch,
              path: targetWorktreePath,
              uncommittedCount,
              committedFiles: diffStats.files,
              insertions: diffStats.insertions,
              deletions: diffStats.deletions,
              status: metadata.worktree.status,
              isMainTree,
              isCwd,
            };
          }),
        );

        // Handle push if requested first
        let pushMessage = "";

        if (push_changes) {
          // Push changes for all worktrees that have uncommitted changes
          const worktreesToPush = worktreeChanges.filter(
            (wt) => !("error" in wt) && wt.uncommittedCount > 0,
          );

          const pushedWorktrees: string[] = [];
          const failedWorktrees: string[] = [];

          for (const wt of worktreesToPush) {
            if (!("error" in wt)) {
              try {
                const gitOptions = { cwd: wt.path };

                // Add all changes
                await gitAdd(".", gitOptions);

                // Commit with a descriptive message
                const commitMessage = `Auto-commit: ${wt.name} changes`;
                await gitCommit(commitMessage, gitOptions);

                // Push to remote
                await gitPush("origin", undefined, gitOptions);

                pushedWorktrees.push(wt.name);
              } catch (error) {
                console.warn(
                  `Warning: Failed to push changes for ${wt.name}: ${error}`,
                );
                failedWorktrees.push(wt.name);
              }
            }
          }

          if (pushedWorktrees.length > 0) {
            pushMessage = `✅ Successfully committed and pushed changes for ${pushedWorktrees.length} worktree${pushedWorktrees.length !== 1 ? "s" : ""}: ${pushedWorktrees.join(", ")}\n\n`;
          } else {
            pushMessage =
              "💡 No worktrees had uncommitted changes to push.\n\n";
          }

          if (failedWorktrees.length > 0) {
            pushMessage += `❌ Failed to push changes for ${failedWorktrees.length} worktree${failedWorktrees.length !== 1 ? "s" : ""}: ${failedWorktrees.join(", ")}\n\n`;
          }
        }

        // Separate cwd, main tree, and other worktrees
        const cwdTree = worktreeChanges.find((wt) => wt.isCwd);
        const mainTree = worktreeChanges.find(
          (wt) => wt.isMainTree && !wt.isCwd,
        );
        const otherTrees = worktreeChanges.filter(
          (wt) => !wt.isMainTree && !wt.isCwd,
        );

        // Format worktree
        const formatWorktree = (
          wt:
            | (typeof worktreeChanges)[0]
            | {
                name: string;
                error: string;
                isMainTree: boolean;
                isCwd: boolean;
              },
        ) => {
          if ("error" in wt) {
            return `• ${wt.name} - ${wt.error}`;
          }

          const committedText =
            wt.committedFiles > 0
              ? `+${wt.insertions}/-${wt.deletions} in ${wt.committedFiles} files`
              : "no committed changes";
          const uncommittedText =
            wt.uncommittedCount > 0
              ? `${wt.uncommittedCount} uncommitted`
              : "no uncommitted changes";

          const labels = [];
          if (wt.isCwd) labels.push("current");
          if (wt.isMainTree) labels.push("main tree");
          const labelSuffix =
            labels.length > 0 ? ` (${labels.join(", ")})` : "";

          return (
            `• ${wt.name}${labelSuffix} (${wt.branch})\n` +
            `  Status: ${wt.status} | ${committedText}, ${uncommittedText}`
          );
        };

        const cwdTreeText = cwdTree ? formatWorktree(cwdTree) : "";
        const mainTreeText = mainTree ? formatWorktree(mainTree) : "";
        const otherTreesText =
          otherTrees.length > 0
            ? otherTrees.map(formatWorktree).join("\n\n")
            : "";

        const worktreeList = [cwdTreeText, mainTreeText, otherTreesText]
          .filter(Boolean)
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text:
                pushMessage +
                `📊 All Worktree Changes (${worktreeChanges.length} worktrees)\n\n` +
                worktreeList,
            },
          ],
        };
      }

      // Show detailed changes for specific worktree
      const targetIdentifier = worktree_identifier;
      const worktree =
        await worktreeManager.getWorktreeByPathOrTaskId(targetIdentifier);

      if (!worktree) {
        // List available worktrees for better error message
        const worktrees = await WorktreeMetadataManager.listAllWorktrees();
        return {
          content: [
            {
              type: "text",
              text: `❌ Worktree '${targetIdentifier}' not found.\n\nAvailable worktrees:\n${worktrees
                .map((ws) => {
                  if (ws.metadata) {
                    return `• ${ws.metadata.worktree.name} (${ws.metadata.worktree.id}) - branch: ${ws.metadata.worktree.branch}`;
                  } else {
                    // Fallback to path-based identifier for worktrees without metadata
                    const pathParts = ws.worktreePath.split("/");
                    const folderName = pathParts[pathParts.length - 1];
                    return `• ${folderName} (no metadata) - ${ws.worktreePath}`;
                  }
                })
                .join(
                  "\n",
                )}\n\n💡 You can use worktree name, task ID, or branch name to identify worktrees.`,
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
      const defaultBranch = await getDefaultBranch();
      let diffStats = { files: 0, insertions: 0, deletions: 0 };
      try {
        diffStats = await gitDiffStats(defaultBranch, "HEAD", {
          cwd: targetWorktreePath,
        });
      } catch {
        try {
          diffStats = await gitDiffStats(`origin/${defaultBranch}`, "HEAD", {
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

      const conversationCount = metadata.conversation_history.length;

      const pushNotice = push_changes
        ? "\n✅ All pending changes have been committed and pushed.\n"
        : "";

      return {
        content: [
          {
            type: "text",
            text:
              `📊 Worktree Changes: ${metadata.worktree.name}\n\n` +
              `Basic Info:\n` +
              `• Task ID: ${metadata.worktree.id}\n` +
              `• Status: ${metadata.worktree.status}\n` +
              `• Branch: ${currentBranch}\n` +
              `• Base Branch: ${metadata.git_info.base_branch}\n` +
              `• Path: ${targetWorktreePath}\n` +
              `• Created: ${new Date(metadata.worktree?.created_at ?? "").toLocaleDateString()}\n` +
              `• Created By: ${metadata.worktree.created_by}\n` +
              `• Conversations: ${conversationCount}\n` +
              `• Integration: ${integrationInfo}\n\n` +
              `Git Changes:\n` +
              `• Committed Changes: ${committedText}\n` +
              `• Uncommitted Changes: ${uncommittedChanges.length} file${uncommittedChanges.length !== 1 ? "s" : ""}\n` +
              `Uncommitted Files:\n${uncommittedText}` +
              pushNotice,
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

export const mergeRemoteWorktreeChangesIntoLocal = {
  name: "grab",
  description:
    "Merge all changes from another worktree into the current worktree",
  cli: {
    aliases: ["grab"],
    flags: [
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier",
      },
      {
        param: "avoid_dry_run",
        alias: "f",
        description: "Force (avoid dry run)",
      },
    ],
  },
  cliFooter:
    "💡 Try asking Claude: 'Get login bug worktree changes' or 'Merge updates from the dashboard branch'\n💡 Run `gwtree grab <identifier>` first to preview changes (dry run)\n💡 Run `gwtree grab <identifier> -f` to actually copy the files",
  mcpFooter:
    '💡 Omit "avoid_dry_run" parameter first to preview changes (dry run)\n💡 Set "avoid_dry_run: true" to actually copy the files from the worktree',
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
    avoid_dry_run: z.boolean().optional().describe("Avoid dry run"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier, avoid_dry_run } = args as {
      worktree_identifier?: string;
      avoid_dry_run?: boolean;
    };

    // If no worktree_identifier provided, show error
    if (!worktree_identifier) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Worktree identifier is required.\n\nUse the "list" tool to see available projects and their worktrees.`,
          },
        ],
      };
    }

    // Find the worktree using the same method as other tools
    const worktree =
      await worktreeManager.getWorktreeByPathOrTaskId(worktree_identifier);

    if (!worktree) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Worktree Not Found\n\nNo worktree found for identifier: \`${worktree_identifier}\`\n\nUse the "list" tool to see available projects and their worktrees.`,
          },
        ],
      };
    }

    const currentDir = await getGitRepositoryPath();
    if (!currentDir) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ No git repository found in current directory or parent directories.\n\nNavigate to a git repository first.`,
          },
        ],
      };
    }

    // Detect the git repository from current directory
    const ownerRepo = await detectWorktreeOwnerRepo(currentDir);
    if (!ownerRepo) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Current directory is not a git repository or worktree.\n\nNavigate to a git repository or worktree first.`,
          },
        ],
      };
    }

    const targetWorkTree = {
      name: worktree.metadata.worktree.name,
      branch: worktree.metadata.worktree.branch,
    };

    const dryRun = !Boolean(avoid_dry_run);

    try {
      const gitOptions = { cwd: ownerRepo };

      // Get current branch
      const currentBranch = await gitCurrentBranch(gitOptions);

      // Check if we're already on the target branch
      if (currentBranch === targetWorkTree.branch) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Cannot bring changes from worktree '${worktree_identifier}' because you are already on branch '${targetWorkTree.branch}'.\n\nSwitch to a different branch first.`,
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
                `❌ Merge Conflicts Detected\n\n` +
                `Cannot bring changes from worktree '${worktree_identifier}' (${targetWorkTree.branch}) due to conflicts:\n\n` +
                `Conflicting files:\n${dryRunResult.conflictFiles.map((file) => `• ${file}`).join("\n")}\n\n` +
                `Resolution options:\n` +
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
            ? `\n\nFiles to be changed (${changedFiles.length}):\n${changedFiles.map((file) => `• ${file}`).join("\n")}`
            : "\n\nNo files to change.";

        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ Dry Run Successful\n\n` +
                `Files from worktree '${worktree_identifier}' (${targetWorkTree.branch}) can be safely copied to '${currentBranch}'.\n\n` +
                `Copy details:\n` +
                `• Source: ${targetWorkTree.branch}\n` +
                `• Target: ${currentBranch}\n` +
                `• No conflicts detected` +
                filesText +
                `\n\nSet avoid_dry_run parameter to copy the files (no history preserved).`,
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
            ? `\n\nFiles changed (${changedFiles.length}):\n${changedFiles.map((file) => `• ${file}`).join("\n")}`
            : "\n\nNo files were changed.";

        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ Files Copied Successfully\n\n` +
                `All files from worktree '${worktree_identifier}' (${targetWorkTree.branch}) have been copied to '${currentBranch}'.\n\n` +
                `Operation: File copy (no history preserved)\n` +
                `Source: ${targetWorkTree.branch}\n` +
                `Target: ${currentBranch}` +
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
