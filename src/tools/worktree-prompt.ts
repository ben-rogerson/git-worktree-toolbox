/**
 * Worktree Prompt Tool - Resume Claude CLI sessions
 *
 * MCP tool for resuming Claude CLI sessions associated with worktrees.
 * Also includes a setup command to initialize global Claude prompt config.
 */

import type { McpTool } from "@/src/tools/types";
import type { WorktreeManager } from "@/src/worktree/manager";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import { sharedParameters } from "@/src/schemas/config-schema";
import { getGitRepositoryPath } from "./utils";
import { resumeClaudeSession } from "@/src/plugins/claude-prompt/index";
import { resumeCursorSession } from "@/src/plugins/cursor-agent/index";
import {
  initializeGlobalAIAgentConfig,
  getGlobalConfigPath,
  loadGlobalAIAgentConfig,
  saveGlobalAIAgentConfig,
  updateLastUsedProvider,
} from "@/src/plugins/shared/config";

export const worktreePrompt = {
  name: "prompt",
  description:
    "Resume AI agent CLI session for a worktree or setup global AI agent prompt configuration",
  cli: {
    aliases: ["prompt", "chat"],
    flags: [
      {
        param: "prompt",
        alias: "m",
        description: "Optional prompt to send when resuming (for scripting)",
      },
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier (task ID, name, or path)",
      },
      {
        param: "setup",
        alias: "s",
        description:
          "Initialize global AI agent prompt configuration (~/.gwtree/ai-agent.yaml)",
      },
      {
        param: "cursor",
        alias: "c",
        description:
          "Use with --setup to configure Cursor agent (defaults to Claude)",
      },
      {
        param: "claude",
        alias: "C",
        description: "Use with --setup to configure Claude agent (explicit)",
      },
      {
        param: "yolo",
        alias: "y",
        description:
          "Launch Claude with dangerously-skip-permissions (yolo mode)",
      },
    ],
  },
  cliFooter:
    "💡 Try asking the MCP: 'Resume AI agent session for task-245' or 'Setup AI agent auto-prompt'\n💡 Run `gwtree prompt setup` to initialize global Claude config\n💡 Run `gwtree prompt setup --cursor` to initialize global Cursor config\n💡 Run `gwtree prompt setup --claude` to explicitly configure Claude\n💡 Run `gwtree prompt` to resume session for current worktree\n💡 Run `gwtree prompt <identifier>` to resume a specific worktree session\n💡 Run `gwtree prompt -m \"prompt\"` to resume with a specific prompt",
  mcpFooter:
    '💡 Set "setup: true" to initialize global AI agent config\n💡 Omit worktree_identifier to use current worktree\n💡 Provide worktree_identifier to resume a specific worktree session\n💡 Add optional "prompt" parameter to send a message when resuming',
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
    prompt: z.string().optional().describe("Optional prompt to send on resume"),
    setup: z
      .boolean()
      .optional()
      .describe("Initialize global AI agent prompt configuration"),
    cursor: z
      .boolean()
      .optional()
      .describe(
        "Use with setup to configure Cursor agent (defaults to Claude)",
      ),
    claude: z
      .boolean()
      .optional()
      .describe("Use with setup to configure Claude agent (explicit)"),
    yolo: z
      .boolean()
      .optional()
      .describe("Launch Claude with dangerously-skip-permissions (yolo mode)"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier, prompt, setup, cursor, yolo } = args as {
      worktree_identifier?: string;
      prompt?: string;
      setup?: boolean;
      cursor?: boolean;
      yolo?: boolean;
    };

    // Handle setup command
    if (setup) {
      try {
        // Determine provider: cursor if --cursor flag, otherwise claude (default or explicit --claude)
        const provider = cursor ? "cursor" : "claude";
        await initializeGlobalAIAgentConfig(provider);

        const existingConfig = await loadGlobalAIAgentConfig();
        if (existingConfig && existingConfig.provider !== provider) {
          existingConfig.provider = provider;
          await saveGlobalAIAgentConfig(existingConfig);
        }

        await updateLastUsedProvider(provider);
        const configPath = getGlobalConfigPath();

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
        const currentWorktree =
          await worktreeManager.getWorktreeByPathOrTaskId(cwd);

        if (currentWorktree) {
          const { v4: uuidv4 } = await import("uuid");
          const sessionId = uuidv4();
          const timestamp = new Date().toISOString();

          if (provider === "cursor") {
            currentWorktree.metadata.cursor_session = {
              enabled: true,
              chat_id: sessionId,
              created_at: timestamp,
            };
          } else {
            currentWorktree.metadata.claude_session = {
              enabled: true,
              session_id: sessionId,
              created_at: timestamp,
            };
          }

          await WorktreeMetadataManager.saveMetadata(
            currentWorktree.worktreePath,
            currentWorktree.metadata,
          );

          const providerName = provider === "cursor" ? "Cursor" : "Claude";
          return {
            content: [
              {
                type: "text",
                text:
                  `✅ ${providerName} configuration initialized!\n\n` +
                  `Config file: ${configPath}\n\n` +
                  `The ${providerName} prompt plugin is now enabled for:\n` +
                  `- Current worktree: ${currentWorktree.metadata.worktree.name}\n` +
                  `- All future worktrees\n\n` +
                  `Edit the config file to customize the prompt template or disable the plugin.\n\n` +
                  `Next steps:\n` +
                  `1. Run: gwtree prompt\n` +
                  `2. ${providerName} CLI will auto-launch with the worktree context`,
              },
            ],
          };
        }

        const providerName = provider === "cursor" ? "Cursor" : "Claude";
        return {
          content: [
            {
              type: "text",
              text:
                `✅ Global ${providerName} configuration initialized!\n\n` +
                `Config file: ${configPath}\n\n` +
                `The ${providerName} prompt plugin is now enabled for all future worktrees.\n\n` +
                `Edit the config file to customize the prompt template or disable the plugin.\n\n` +
                `Next steps:\n` +
                `1. Create a new worktree: gwtree new "Your task description"\n` +
                `2. ${providerName} CLI will auto-launch with the worktree context\n` +
                `3. Resume later: gwtree prompt <worktree-identifier>`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Failed to initialize global config: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }

    try {
      // Use current worktree if no identifier provided
      const identifier = worktree_identifier || (await getGitRepositoryPath());
      if (!identifier) {
        return {
          content: [
            {
              type: "text",
              text: "❌ No git repository found in current directory or parent directories.\n\nNavigate to a git repository first.",
            },
          ],
        };
      }

      // Find the worktree
      const worktree =
        await worktreeManager.getWorktreeByPathOrTaskId(identifier);

      if (!worktree) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Worktree not found: ${identifier}\n\nRun "gwtree list" to see available worktrees.`,
            },
          ],
        };
      }

      // Determine which provider to use
      const globalConfig = await loadGlobalAIAgentConfig();
      const provider = globalConfig?.provider || "claude";

      // Check what sessions exist for this worktree
      const hasClaudeSession = !!worktree.metadata.claude_session?.session_id;
      const hasCursorSession = !!worktree.metadata.cursor_session?.chat_id;

      // If we have a session for the current provider, use it
      if (provider === "cursor" && hasCursorSession) {
        // Resume the Cursor session
        await resumeCursorSession({
          worktreePath: worktree.worktreePath,
          chatId: worktree.metadata.cursor_session!.chat_id,
          prompt,
          forceMode: yolo,
        });

        return {
          content: [
            {
              type: "text",
              text:
                `✨ Cursor session resumed!\n\n` +
                `Worktree: ${worktree.metadata.worktree.name}\n` +
                `Chat ID: ${worktree.metadata.cursor_session!.chat_id}\n` +
                `Path: ${worktree.worktreePath}\n\n` +
                `Cursor Agent CLI is now running in your terminal.`,
            },
          ],
        };
      } else if (provider === "claude" && hasClaudeSession) {
        // Resume the Claude session
        await resumeClaudeSession({
          worktreePath: worktree.worktreePath,
          sessionId: worktree.metadata.claude_session!.session_id,
          prompt,
          permissionMode: yolo,
        });

        return {
          content: [
            {
              type: "text",
              text:
                `✨ Claude session resumed!\n\n` +
                `Worktree: ${worktree.metadata.worktree.name}\n` +
                `Session ID: ${worktree.metadata.claude_session!.session_id}\n` +
                `Path: ${worktree.worktreePath}\n\n` +
                `Claude CLI is now running in your terminal.`,
            },
          ],
        };
      }

      // No session found for current provider - check if we have a session for the other provider
      const otherProvider = provider === "cursor" ? "claude" : "cursor";
      const hasOtherSession =
        otherProvider === "cursor" ? hasCursorSession : hasClaudeSession;

      if (hasOtherSession) {
        // Automatically create a new session for the current provider
        console.log(
          `\n🔄 Switching from ${otherProvider} to ${provider} - creating new session...\n`,
        );

        if (provider === "cursor") {
          const { v4: uuidv4 } = await import("uuid");
          const chatId = uuidv4();
          const timestamp = new Date().toISOString();

          worktree.metadata.cursor_session = {
            enabled: true,
            chat_id: chatId,
            created_at: timestamp,
          };

          await WorktreeMetadataManager.saveMetadata(
            worktree.worktreePath,
            worktree.metadata,
          );

          // Resume the new Cursor session
          await resumeCursorSession({
            worktreePath: worktree.worktreePath,
            chatId,
            prompt,
            forceMode: yolo,
          });

          return {
            content: [
              {
                type: "text",
                text:
                  `✨ Created new Cursor session!\n\n` +
                  `Worktree: ${worktree.metadata.worktree.name}\n` +
                  `Chat ID: ${chatId}\n` +
                  `Path: ${worktree.worktreePath}\n\n` +
                  `Cursor Agent CLI is now running in your terminal.`,
              },
            ],
          };
        } else {
          const { v4: uuidv4 } = await import("uuid");
          const sessionId = uuidv4();
          const timestamp = new Date().toISOString();

          worktree.metadata.claude_session = {
            enabled: true,
            session_id: sessionId,
            created_at: timestamp,
          };

          await WorktreeMetadataManager.saveMetadata(
            worktree.worktreePath,
            worktree.metadata,
          );

          // Resume the new Claude session
          await resumeClaudeSession({
            worktreePath: worktree.worktreePath,
            sessionId,
            prompt,
            permissionMode: yolo,
          });

          return {
            content: [
              {
                type: "text",
                text:
                  `✨ Created new Claude session!\n\n` +
                  `Worktree: ${worktree.metadata.worktree.name}\n` +
                  `Session ID: ${sessionId}\n` +
                  `Path: ${worktree.worktreePath}\n\n` +
                  `Claude CLI is now running in your terminal.`,
              },
            ],
          };
        }
      }

      // No sessions found at all
      return {
        content: [
          {
            type: "text",
            text:
              `❌ No AI agent session found for worktree "${worktree.metadata.worktree.name}"\n\n` +
              `To connect an AI agent to this worktree:\n\n` +
              `- For claude cli run: gwtree prompt setup\n` +
              `- For cursor agent run: gwtree prompt setup --cursor`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to resume AI agent session: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;
