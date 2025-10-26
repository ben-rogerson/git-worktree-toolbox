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
import { renderTemplate } from "@/src/plugins/shared/templates";
import type { TemplateVariables } from "@/src/plugins/shared/types";
import {
  loadGlobalAIAgentConfig,
  updateLastUsedProvider,
} from "@/src/plugins/shared/config";

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

    // INTERACTIVE MODE: Launch Claude CLI with interactive session
    // NOTE: This function should ONLY be called in interactive mode
    // In non-interactive mode, the worktree manager skips calling this function

    // Build command args - start interactive session with initial prompt
    const args = [prompt, "--session-id", sessionId];
    if (permissionMode) {
      args.push("--dangerously-skip-permissions");
    }

    // Provide feedback before spawning
    console.log("\n🚀 Launching Claude CLI...");

    // Small delay to ensure the message is visible
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(
      `\n✨ Claude CLI launched with session ID: ${sessionId}\n` +
        `   Resume later with: gwtree prompt <worktree-identifier>\n`,
    );

    // Spawn Claude CLI with inherited stdio for interactive session
    const claudeProcess = spawn("claude", args, {
      cwd: worktreePath,
      env: { ...process.env },
      stdio: "inherit",
      detached: true,
    });

    // Wait for Claude process to exit
    await new Promise<void>((resolve, reject) => {
      claudeProcess.on("error", (error) => {
        console.warn(`Failed to launch Claude CLI: ${error.message}`);
        reject(error);
      });

      claudeProcess.on("exit", (code) => {
        if (code === 0) {
          console.log("\n✅ Claude CLI session ended successfully");
        } else {
          console.log(`\n⚠️  Claude CLI exited with code: ${code}`);
        }
        resolve();
      });
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

    // INTERACTIVE MODE: Resume Claude CLI session
    // NOTE: This function should ONLY be called in interactive mode
    // In non-interactive mode, this should not be called

    // Build command args - prompt must come before --resume flag
    const args = [];
    if (prompt) {
      args.push(prompt);
    }
    args.push("--resume", sessionId);
    if (permissionMode) {
      args.push("--dangerously-skip-permissions");
    }

    // Provide feedback before spawning
    console.log("\n🔄 Resuming Claude session...");

    // Small delay to ensure the message is visible
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update last_resumed_at timestamp
    const metadata = await WorktreeMetadataManager.loadMetadata(worktreePath);
    if (metadata?.claude_session) {
      metadata.claude_session.last_resumed_at = new Date().toISOString();
      await WorktreeMetadataManager.saveMetadata(worktreePath, metadata);
    }

    console.log(`\n✨ Resumed Claude session: ${sessionId}\n`);

    // Spawn Claude CLI with inherited stdio for interactive session
    const claudeProcess = spawn("claude", args, {
      cwd: worktreePath,
      env: { ...process.env },
      stdio: ["inherit", "inherit", "pipe"],
      detached: true,
    });

    let stderrOutput = "";

    if (claudeProcess.stderr) {
      claudeProcess.stderr.on("data", (data) => {
        const text = data.toString();
        stderrOutput += text;
        process.stderr.write(data);
      });
    }

    // Wait for Claude process to exit
    await new Promise<void>((resolve, reject) => {
      claudeProcess.on("error", (error) => {
        reject(new Error(`Failed to launch Claude CLI: ${error.message}`));
      });

      claudeProcess.on("exit", async (code) => {
        if (code === 0) {
          console.log("\n✅ Claude CLI session ended successfully");
          resolve();
        } else if (
          code === 1 &&
          stderrOutput.includes("No conversation found with session ID")
        ) {
          console.log(
            "\n⚠️  Session not found. Starting new session instead...\n",
          );

          await executeClaudePrompt({
            worktreePath,
            sessionId,
            prompt: prompt || "",
            permissionMode,
          });
          resolve();
        } else {
          console.log(`\n⚠️  Claude CLI exited with code: ${code}`);
          resolve();
        }
      });
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
  const globalConfig = await loadGlobalAIAgentConfig();

  if (!globalConfig?.enabled || globalConfig.provider !== "claude") {
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

  metadata.claude_session = {
    enabled: true,
    session_id: sessionId,
    created_at: new Date().toISOString(),
    prompt_template: template,
  };

  await WorktreeMetadataManager.saveMetadata(worktreePath, metadata);
  await updateLastUsedProvider("claude");

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
