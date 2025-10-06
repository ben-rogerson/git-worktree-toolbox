/**
 * Git Utilities - Git command execution wrapper: status, diff, add, commit, push, branch operations, worktree commands
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Check if a file path should be ignored (Claude directories and backups)
 */
function shouldIgnoreFile(filePath: string): boolean {
  const trimmed = filePath.trim();
  return (
    !trimmed ||
    trimmed.startsWith(".claude/") ||
    trimmed.startsWith(".claude.backup") ||
    trimmed.startsWith(".claude-backup")
  );
}

export interface GitCommandOptions {
  cwd?: string;
  timeout?: number;
}

export interface GitError extends Error {
  code: "GIT_ERROR" | "GIT_TIMEOUT" | "GIT_NOT_FOUND";
  command: string;
  stdout?: string;
  stderr?: string;
}

function createGitError(
  message: string,
  code: GitError["code"],
  command: string,
  stdout?: string,
  stderr?: string,
): GitError {
  const error = new Error(message) as GitError;
  error.code = code;
  error.command = command;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

export async function executeGitCommand(
  command: string,
  options: GitCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, timeout = 30000 } = options;

  try {
    // console.info(`\n💁‍ Git command:\n${command} ${JSON.stringify(options)}`);
    const result = await execAsync(command, {
      cwd,
      timeout,
      encoding: "utf8",
    });
    return result;
  } catch (error: any) {
    const isTimeout = error.killed && error.signal === "SIGTERM";
    const errorCode = isTimeout ? "GIT_TIMEOUT" : "GIT_ERROR";

    throw createGitError(
      `Git command failed: ${error.message}`,
      errorCode,
      command,
      error.stdout,
      error.stderr,
    );
  }
}

export async function gitWorktreeAdd(
  path: string,
  branch: string,
  options: GitCommandOptions = {},
): Promise<void> {
  const command = `git worktree add "${path}" "${branch}"`;
  await executeGitCommand(command, options);
}

/**
 * Detect which repository owns a given worktree path
 */
export async function detectWorktreeOwnerRepo(
  worktreePath: string,
): Promise<string | null> {
  try {
    const fs = await import("fs");
    const path = await import("path");

    const gitFile = path.join(worktreePath, ".git");
    if (!fs.existsSync(gitFile)) {
      return null;
    }

    const gitContent = fs.readFileSync(gitFile, "utf8").trim();
    if (gitContent.startsWith("gitdir: ")) {
      const gitDir = gitContent.replace("gitdir: ", "");
      // Extract the main repository path from the worktree gitdir
      // e.g., /path/to/repo/.git/worktrees/worktree-name -> /path/to/repo
      const worktreesIndex = gitDir.indexOf("/.git/worktrees/");
      if (worktreesIndex !== -1) {
        return gitDir.substring(0, worktreesIndex);
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function gitWorktreeRemove(
  path: string,
  force = false,
  options: GitCommandOptions = {},
): Promise<void> {
  // First prune any stale worktrees to ensure we have an accurate list
  try {
    await executeGitCommand("git worktree prune", options);
  } catch {
    // Ignore prune errors
  }

  // Check if this is actually a valid worktree in the current repository
  const listOutput = await gitWorktreeList(options);
  const worktrees = listOutput.split("\n\n").filter((entry) => entry.trim());
  const isValidWorktree = worktrees.some((entry) => {
    const lines = entry.split("\n");
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    if (!worktreeLine) return false;

    // Extract the path from the worktree line and normalize it
    const worktreePath = worktreeLine.replace("worktree ", "").trim();
    const normalizedWorktreePath = worktreePath.replace(/\/$/, ""); // Remove trailing slash
    const normalizedInputPath = path.replace(/\/$/, ""); // Remove trailing slash

    return normalizedWorktreePath === normalizedInputPath;
  });

  if (!isValidWorktree) {
    // Try to find the owning repository and remove from there
    const ownerRepo = await detectWorktreeOwnerRepo(path);
    if (ownerRepo) {
      console.info(`Worktree belongs to different repository: ${ownerRepo}`);
      const ownerOptions = { ...options, cwd: ownerRepo };

      // Prune worktrees in the owner repository
      await executeGitCommand("git worktree prune", ownerOptions);

      const forceFlag = force ? " --force" : "";
      const command = `git worktree remove "${path}"${forceFlag}`;
      await executeGitCommand(command, ownerOptions);

      // Prune again after removal
      await executeGitCommand("git worktree prune", ownerOptions);
      return;
    }

    throw new Error(`Path '${path}' is not a valid git worktree`);
  }

  const forceFlag = force ? " --force" : "";
  const command = `git worktree remove "${path}"${forceFlag}`;
  await executeGitCommand(command, options);

  // Prune again after removal to clean up any orphaned metadata
  await executeGitCommand("git worktree prune", options);
}

export async function gitWorktreeList(
  options: GitCommandOptions = {},
): Promise<string> {
  const command = "git worktree list --porcelain";
  const result = await executeGitCommand(command, options);
  return result.stdout;
}

export async function gitStatus(
  options: GitCommandOptions = {},
): Promise<string> {
  const command = "git status --porcelain";
  const result = await executeGitCommand(command, options);
  return result.stdout;
}

export async function gitAdd(
  files: string | string[] = ".",
  options: GitCommandOptions = {},
): Promise<void> {
  const fileList = Array.isArray(files) ? files.join(" ") : files;
  const command = `git add ${fileList}`;
  await executeGitCommand(command, options);
}

export async function gitCommit(
  message: string,
  options: GitCommandOptions = {},
): Promise<string> {
  const command = `git commit -m "${message.replace(/"/g, '\\"')}"`;
  const result = await executeGitCommand(command, options);
  return result.stdout;
}

export async function gitHasRemote(
  remote = "origin",
  options: GitCommandOptions = {},
): Promise<boolean> {
  try {
    const command = `git remote get-url ${remote}`;
    await executeGitCommand(command, options);
    return true;
  } catch {
    return false;
  }
}

export async function gitPush(
  remote = "origin",
  branch?: string,
  options: GitCommandOptions = {},
): Promise<void> {
  // Check if the remote exists before attempting to push
  const remoteExists = await gitHasRemote(remote, options);
  if (!remoteExists) {
    throw createGitError(
      `Remote '${remote}' does not exist. Cannot push changes.`,
      "GIT_ERROR",
      `git push -u ${remote}${branch ? ` ${branch}` : ""}`,
    );
  }

  const branchArg = branch ? ` ${branch}` : "";
  const command = `git push -u ${remote}${branchArg}`;
  await executeGitCommand(command, options);
}

export async function gitBranchExists(
  branch: string,
  options: GitCommandOptions = {},
): Promise<boolean> {
  try {
    const command = `git rev-parse --verify "${branch}"`;
    await executeGitCommand(command, options);
    return true;
  } catch {
    return false;
  }
}

export async function gitHasCommits(
  options: GitCommandOptions = {},
): Promise<boolean> {
  try {
    const command = "git rev-parse HEAD";
    await executeGitCommand(command, options);
    return true;
  } catch {
    return false;
  }
}

export async function gitCreateBranch(
  branch: string,
  startPoint = "HEAD",
  options: GitCommandOptions = {},
): Promise<void> {
  const command = `git branch "${branch}" "${startPoint}"`;
  await executeGitCommand(command, options);
}

export async function gitCurrentBranch(
  options: GitCommandOptions = {},
): Promise<string> {
  const command = "git branch --show-current";
  const result = await executeGitCommand(command, options);
  return result.stdout.trim();
}

export async function gitMergeDryRun(
  targetBranch: string,
  options: GitCommandOptions = {},
): Promise<{ conflicts: boolean; conflictFiles: string[] }> {
  try {
    const command = `git merge --no-commit --no-ff "${targetBranch}"`;
    await executeGitCommand(command, options);

    // If we reach here, no conflicts - abort the merge
    await executeGitCommand("git merge --abort", options);
    return { conflicts: false, conflictFiles: [] };
  } catch (error: any) {
    if (error.stderr?.includes("CONFLICT")) {
      // Get conflict files from status
      const statusResult = await executeGitCommand(
        "git status --porcelain",
        options,
      );
      const conflictFiles = statusResult.stdout
        .split("\n")
        .filter((line) => line.startsWith("UU") || line.startsWith("AA"))
        .map((line) => line.slice(3));

      // Abort the merge
      try {
        await executeGitCommand("git merge --abort", options);
      } catch {
        // Ignore abort errors
      }

      return { conflicts: true, conflictFiles };
    }
    throw error;
  }
}

export async function gitCheckoutFiles(
  branch: string,
  options: GitCommandOptions = {},
): Promise<void> {
  // Get list of files to checkout, excluding .claude directory and backup folders
  const filesCommand = `git diff --name-only HEAD "${branch}"`;
  const filesResult = await executeGitCommand(filesCommand, options);

  const filesToCheckout = filesResult.stdout
    .trim()
    .split("\n")
    .filter((file) => !shouldIgnoreFile(file))
    .join(" ");

  if (filesToCheckout) {
    const command = `git checkout "${branch}" -- ${filesToCheckout}`;
    await executeGitCommand(command, options);
  }
}

export interface GitDiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

export async function gitDiffStats(
  ref1?: string,
  ref2?: string,
  options: GitCommandOptions = {},
): Promise<GitDiffStats> {
  let command = "git diff --numstat";
  if (ref1 && ref2) {
    command += ` "${ref1}" "${ref2}"`;
  } else if (ref1) {
    command += ` "${ref1}"`;
  }

  const result = await executeGitCommand(command, options);
  const lines = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim());

  if (lines.length === 0) {
    return { files: 0, insertions: 0, deletions: 0 };
  }

  let totalInsertions = 0;
  let totalDeletions = 0;
  let fileCount = 0;

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const insertions = parseInt(parts[0]) || 0;
      const deletions = parseInt(parts[1]) || 0;
      totalInsertions += insertions;
      totalDeletions += deletions;
      fileCount++;
    }
  }

  return {
    files: fileCount,
    insertions: totalInsertions,
    deletions: totalDeletions,
  };
}

export async function gitDiffFileList(
  ref1?: string,
  ref2?: string,
  options: GitCommandOptions = {},
): Promise<string[]> {
  let command = "git diff --name-only";
  if (ref1 && ref2) {
    command += ` "${ref1}" "${ref2}"`;
  } else if (ref1) {
    command += ` "${ref1}"`;
  }

  const result = await executeGitCommand(command, options);
  return result.stdout
    .trim()
    .split("\n")
    .filter((line) => !shouldIgnoreFile(line));
}

export async function gitHasPendingChanges(
  options: GitCommandOptions = {},
): Promise<boolean> {
  const statusOutput = await gitStatus(options);
  const lines = statusOutput
    .trim()
    .split("\n")
    .filter((line) => line.trim());

  // Filter out common metadata files that shouldn't block removal
  const significantChanges = lines.filter((line) => {
    // Parse git status line format: "XY filename" or " X filename"
    // X and Y are status codes, filename starts after the status codes and spaces
    const trimmedLine = line.trim();
    const match = trimmedLine.match(/^[AMDRC?]{1,2}\s+(.+)$/);
    if (!match) {
      // If we can't parse the line, include it to be safe
      return true;
    }

    const filePath = match[1];
    const shouldIgnore = shouldIgnoreFile(filePath);
    const isGitignore = filePath.match(/^\.gitignore$/);
    const shouldInclude = !shouldIgnore && !isGitignore;

    return shouldInclude;
  });

  return significantChanges.length > 0;
}

export async function gitDeleteBranch(
  branch: string,
  force = false,
  options: GitCommandOptions = {},
): Promise<void> {
  const forceFlag = force ? " -D" : " -d";
  const command = `git branch${forceFlag} "${branch}"`;
  await executeGitCommand(command, options);
}
