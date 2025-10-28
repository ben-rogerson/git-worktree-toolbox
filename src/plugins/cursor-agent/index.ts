/**
 * Cursor Agent Plugin
 *
 * Auto-launches Cursor Agent CLI when creating worktrees with persistent session support.
 * Sessions are tracked in worktree metadata and can be resumed later.
 */

import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { WorktreeMetadata } from "@/src/worktree/types";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import {
  ExecuteCursorPromptOptions,
  ResumeCursorSessionOptions,
} from "./types";
import { renderTemplate } from "@/src/plugins/shared/templates";
import type { TemplateVariables } from "@/src/plugins/shared/types";
import {
  loadGlobalAIAgentConfig,
  updateLastUsedProvider,
} from "@/src/plugins/shared/config";

export async function executeCursorPrompt(
  options: ExecuteCursorPromptOptions,
): Promise<void> {
  const { worktreePath, chatId, prompt, forceMode } = options;

  try {
    const cursorAvailable = await isCursorCliAvailable();
    if (!cursorAvailable) {
      console.warn(
        "Cursor Agent CLI not found. Skipping auto-prompt. Install from: https://cursor.com",
      );
      return;
    }

    // INTERACTIVE MODE: Launch Cursor Agent CLI with interactive session
    // NOTE: This function should ONLY be called in interactive mode
    // In non-interactive mode, the worktree manager skips calling this function

    const args = [];
    if (forceMode) {
      args.push("--force");
    }

    console.log("\n🚀 Launching Cursor Agent CLI...");
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(
      `\n✨ Cursor Agent CLI launched with chat ID: ${chatId}\n` +
        `   Resume later with: gwtree prompt <worktree-identifier>\n`,
    );

    // Properly quote the prompt to handle spaces and newlines
    const quotedPrompt = `"${prompt.replace(/"/g, '\\"')}"`;
    const command = `cd "${worktreePath}" && cursor-agent ${quotedPrompt} ${args.join(" ")}`;

    const cursorProcess = spawn(command, {
      shell: true,
      env: { ...process.env, CURSOR_CHAT_ID: chatId },
      stdio: "inherit",
      detached: true,
    });

    await new Promise<void>((resolve, reject) => {
      cursorProcess.on("error", (error) => {
        console.warn(`Failed to launch Cursor Agent CLI: ${error.message}`);
        reject(error);
      });

      cursorProcess.on("exit", (code) => {
        if (code === 0) {
          console.log("\n✅ Cursor Agent CLI session ended successfully");
        } else {
          console.log(`\n⚠️  Cursor Agent CLI exited with code: ${code}`);
        }
        resolve();
      });
    });
  } catch (error) {
    console.warn(`Failed to execute Cursor prompt: ${error}`);
  }
}

export async function resumeCursorSession(
  options: ResumeCursorSessionOptions,
): Promise<void> {
  const { worktreePath, chatId, prompt, forceMode } = options;

  try {
    const cursorAvailable = await isCursorCliAvailable();
    if (!cursorAvailable) {
      throw new Error(
        "Cursor Agent CLI not found. Install from: https://cursor.com",
      );
    }

    // INTERACTIVE MODE: Resume Cursor Agent session
    // NOTE: This function should ONLY be called in interactive mode
    // In non-interactive mode, this should not be called

    const args = [];

    // Always provide a prompt for cursor-agent (it requires one even for resume)
    // If no prompt is provided, use a default "continue" message
    const resumePrompt = prompt || "continue";
    args.push(`"${resumePrompt.replace(/"/g, '\\"')}"`);

    args.push("--resume", chatId);
    if (forceMode) {
      args.push("--force");
    }

    console.log("\n🔄 Resuming Cursor Agent session...");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metadata = await WorktreeMetadataManager.loadMetadata(worktreePath);
    if (metadata?.cursor_session) {
      metadata.cursor_session.last_resumed_at = new Date().toISOString();
      await WorktreeMetadataManager.saveMetadata(worktreePath, metadata);
    }

    console.log(`\n✨ Resumed Cursor Agent session: ${chatId}\n`);

    const command = `cd "${worktreePath}" && cursor-agent ${args.join(" ")}`;

    const cursorProcess = spawn(command, {
      shell: true,
      env: { ...process.env },
      stdio: ["inherit", "inherit", "pipe"],
      detached: true,
    });

    let stderrOutput = "";

    if (cursorProcess.stderr) {
      cursorProcess.stderr.on("data", (data) => {
        const text = data.toString();
        stderrOutput += text;
        process.stderr.write(data);
      });
    }

    await new Promise<void>((resolve, reject) => {
      cursorProcess.on("error", (error) => {
        reject(
          new Error(`Failed to launch Cursor Agent CLI: ${error.message}`),
        );
      });

      cursorProcess.on("exit", async (code) => {
        if (code === 0) {
          console.log("\n✅ Cursor Agent CLI session ended successfully");
          resolve();
        } else if (
          code === 1 &&
          stderrOutput.includes("No chat found with ID")
        ) {
          console.log(
            "\n⚠️  Session not found. Starting new session instead...\n",
          );

          await executeCursorPrompt({
            worktreePath,
            chatId,
            prompt: prompt || "",
            forceMode,
          });
          resolve();
        } else {
          console.log(`\n⚠️  Cursor Agent CLI exited with code: ${code}`);
          resolve();
        }
      });
    });
  } catch (error) {
    throw new Error(
      `Failed to resume Cursor Agent session: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function executeCursorPromptForWorktree(
  worktreePath: string,
  metadata: WorktreeMetadata,
  taskDescription: string,
  permissionMode: boolean,
): Promise<void> {
  const globalConfig = await loadGlobalAIAgentConfig();

  if (!globalConfig?.enabled || globalConfig.provider !== "cursor") {
    return;
  }

  const chatId = uuidv4();
  const template = globalConfig.prompt_template || "";

  const variables: TemplateVariables = {
    task_description: taskDescription,
    branch: metadata.worktree.branch,
    base_branch: metadata.git_info.base_branch,
    worktree_path: worktreePath,
    worktree_name: metadata.worktree.name,
  };

  const prompt = renderTemplate(template, variables);

  metadata.cursor_session = {
    enabled: true,
    chat_id: chatId,
    created_at: new Date().toISOString(),
    prompt_template: template,
  };

  await WorktreeMetadataManager.saveMetadata(worktreePath, metadata);
  await updateLastUsedProvider("cursor");

  await executeCursorPrompt({
    worktreePath,
    chatId,
    prompt,
    forceMode: permissionMode ?? globalConfig.permission_mode,
  });
}

async function isCursorCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn("which", ["cursor-agent"]);
    checkProcess.on("exit", (code) => {
      resolve(code === 0);
    });
    checkProcess.on("error", () => {
      resolve(false);
    });
  });
}
