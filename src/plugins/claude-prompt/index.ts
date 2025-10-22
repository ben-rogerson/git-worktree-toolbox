/**
 * Claude Prompt Plugin
 *
 * Auto-launches Claude CLI when creating worktrees with persistent session support.
 * Sessions are tracked in worktree metadata and can be resumed later.
 */

import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { WorktreeMetadata } from "@/src/worktree/types";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import {
  ExecuteClaudePromptOptions,
  ResumeClaudeSessionOptions,
} from "./types";
import { renderTemplate, TemplateVariables } from "./templates";
import { loadGlobalClaudeConfig } from "./config";

export async function executeClaudePrompt(
  options: ExecuteClaudePromptOptions,
): Promise<void> {
  const { worktreePath, sessionId, prompt, permissionMode } = options;

  try {
    // Check if claude CLI is available
    const claudeAvailable = await isClaudeCliAvailable();
    if (!claudeAvailable) {
      console.warn(
        "Claude CLI not found. Skipping auto-prompt. Install from: https://claude.ai/download",
      );
      return;
    }

    // Build command args
    const args = ["-p", prompt, "--session-id", sessionId];
    if (permissionMode) {
      args.push("--dangerously-skip-permissions");
    }

    console.log("args", args);
    console.log("permissionMode", permissionMode);
    console.log("prompt", prompt);
    console.log("sessionId", sessionId);
    console.log("worktreePath", worktreePath);

    // Provide feedback before spawning
    console.log("\n🚀 Launching Claude CLI...");

    // Small delay to ensure the message is visible
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Spawn Claude CLI in the worktree directory
    const claudeProcess = spawn("claude", args, {
      cwd: worktreePath,
      stdio: "inherit",
      detached: false,
    });

    claudeProcess.on("error", (error) => {
      console.warn(`Failed to launch Claude CLI: ${error.message}`);
    });

    claudeProcess.on("spawn", () => {
      console.log(
        `\n✨ Claude CLI launched with session ID: ${sessionId}\n` +
          `   Resume later with: gwtree prompt <worktree-identifier>\n`,
      );
    });
  } catch (error) {
    console.warn(`Failed to execute Claude prompt: ${error}`);
  }
}

export async function resumeClaudeSession(
  options: ResumeClaudeSessionOptions,
): Promise<void> {
  const { worktreePath, sessionId, prompt, permissionMode } = options;

  try {
    // Check if claude CLI is available
    const claudeAvailable = await isClaudeCliAvailable();
    if (!claudeAvailable) {
      throw new Error(
        "Claude CLI not found. Install from: https://claude.ai/download",
      );
    }

    // Build command args
    const args = ["--resume", sessionId];
    if (prompt) {
      args.push(prompt);
    }
    if (permissionMode) {
      args.push("--dangerously-skip-permissions");
    }

    // console.log("args", args);
    // console.log("permissionMode", permissionMode);
    // console.log("prompt", prompt);
    // console.log("sessionId", sessionId);
    // console.log("worktreePath", worktreePath);

    // Provide feedback before spawning
    console.log("\n🔄 Resuming Claude session...");

    // Small delay to ensure the message is visible
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Spawn Claude CLI in the worktree directory
    const claudeProcess = spawn("claude", args, {
      cwd: worktreePath,
      stdio: "inherit",
      detached: false,
    });

    claudeProcess.on("error", (error) => {
      throw new Error(`Failed to launch Claude CLI: ${error.message}`);
    });

    claudeProcess.on("spawn", async () => {
      // Update last_resumed_at timestamp
      const metadata = await WorktreeMetadataManager.loadMetadata(worktreePath);
      if (metadata?.claude_session) {
        metadata.claude_session.last_resumed_at = new Date().toISOString();
        await WorktreeMetadataManager.saveMetadata(worktreePath, metadata);
      }

      console.log(`\n✨ Resumed Claude session: ${sessionId}\n`);
    });
  } catch (error) {
    throw new Error(
      `Failed to resume Claude session: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function executeClaudePromptForWorktree(
  worktreePath: string,
  metadata: WorktreeMetadata,
  taskDescription: string,
  permissionMode: boolean,
): Promise<void> {
  const globalConfig = await loadGlobalClaudeConfig();

  if (!globalConfig?.enabled) {
    return;
  }

  const sessionId = uuidv4();
  const template = globalConfig.prompt_template || "";

  const variables: TemplateVariables = {
    task_description: taskDescription,
    branch: metadata.worktree.branch,
    base_branch: metadata.git_info.base_branch,
    worktree_path: worktreePath,
    worktree_name: metadata.worktree.name,
  };

  const prompt = renderTemplate(template, variables);

  // Save Claude session to metadata
  metadata.claude_session = {
    enabled: true,
    session_id: sessionId,
    created_at: new Date().toISOString(),
    prompt_template: template,
  };

  await WorktreeMetadataManager.saveMetadata(worktreePath, metadata);

  // Execute Claude prompt
  await executeClaudePrompt({
    worktreePath,
    sessionId,
    prompt,
    permissionMode: permissionMode ?? globalConfig.permission_mode,
  });
}

async function isClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn("which", ["claude"]);
    checkProcess.on("exit", (code) => {
      resolve(code === 0);
    });
    checkProcess.on("error", () => {
      resolve(false);
    });
  });
}
