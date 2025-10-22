/**
 * Worktree Prompt Tool - Resume Claude CLI sessions
 *
 * MCP tool for resuming Claude CLI sessions associated with worktrees.
 * Also includes a setup command to initialize global Claude prompt config.
 */

import type { McpTool } from "@/src/tools/types";
import type { WorktreeManager } from "@/src/worktree/manager";
import { sharedParameters } from "@/src/schemas/config-schema";
import { resumeClaudeSession } from "@/src/plugins/claude-prompt/index";
import {
  initializeGlobalClaudeConfig,
  getGlobalConfigPath,
} from "@/src/plugins/claude-prompt/config";

export const worktreePrompt = {
  name: "prompt",
  description:
    "Resume Claude CLI session for a worktree or setup global Claude prompt configuration",
  cli: {
    aliases: ["prompt", "chat"],
    flags: [
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier (task ID, name, or path)",
      },
      {
        param: "prompt",
        alias: "m",
        description: "Optional prompt to send when resuming (for scripting)",
      },
      {
        param: "setup",
        alias: "s",
        description:
          "Initialize global Claude prompt configuration (~/.gwtree/claude-prompt.yaml)",
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
    "💡 Try asking the MCP: 'Resume Claude session for task-245' or 'Setup Claude auto-prompt'\n💡 Run `gwtree prompt --setup` to initialize global Claude config\n💡 Run `gwtree prompt <identifier>` to resume a Claude session\n💡 Run `gwtree prompt <identifier> -m \"prompt\"` to resume with a specific prompt",
  mcpFooter:
    '💡 Set "setup: true" to initialize global Claude config\n💡 Provide worktree_identifier to resume a Claude session\n💡 Add optional "prompt" parameter to send a message when resuming',
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
    prompt: z.string().optional().describe("Optional prompt to send on resume"),
    setup: z
      .boolean()
      .optional()
      .describe("Initialize global Claude prompt configuration"),
    yolo: z
      .boolean()
      .optional()
      .describe("Launch Claude with dangerously-skip-permissions (yolo mode)"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier, prompt, setup, yolo } = args as {
      worktree_identifier?: string;
      prompt?: string;
      setup?: boolean;
      yolo?: boolean;
    };

    // Handle setup command
    if (setup) {
      try {
        await initializeGlobalClaudeConfig();
        const configPath = getGlobalConfigPath();
        return {
          content: [
            {
              type: "text",
              text:
                `✅ Global Claude configuration initialized!\n\n` +
                `Config file: ${configPath}\n\n` +
                `The Claude prompt plugin is now enabled for all new worktrees.\n` +
                `Edit the config file to customize the prompt template or disable the plugin.\n\n` +
                `Next steps:\n` +
                `1. Create a new worktree: gwtree new "Your task description"\n` +
                `2. Claude CLI will auto-launch with the worktree context\n` +
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

    // Require worktree_identifier for resume
    if (!worktree_identifier) {
      return {
        content: [
          {
            type: "text",
            text:
              `❌ Missing worktree identifier\n\n` +
              `Usage:\n` +
              `  gwtree prompt <worktree-identifier>         # Resume Claude session\n` +
              `  gwtree prompt <identifier> -m "message"     # Resume with prompt\n` +
              `  gwtree prompt --setup                       # Initialize config\n\n` +
              `Run "gwtree list" to see available worktrees.`,
          },
        ],
      };
    }

    try {
      // Find the worktree
      const worktree =
        await worktreeManager.getWorktreeByPathOrTaskId(worktree_identifier);

      if (!worktree) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Worktree not found: ${worktree_identifier}\n\nRun "gwtree list" to see available worktrees.`,
            },
          ],
        };
      }

      // Check if worktree has a Claude session
      if (!worktree.metadata.claude_session?.session_id) {
        return {
          content: [
            {
              type: "text",
              text:
                `❌ No Claude session found for worktree "${worktree.metadata.worktree.name}"\n\n` +
                `This worktree was not created with the Claude prompt plugin enabled.\n\n` +
                `To enable:\n` +
                `1. Run: gwtree prompt --setup\n` +
                `2. Create new worktrees with: gwtree new "task description"`,
            },
          ],
        };
      }

      // Resume the Claude session
      await resumeClaudeSession({
        worktreePath: worktree.worktreePath,
        sessionId: worktree.metadata.claude_session.session_id,
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
              `Session ID: ${worktree.metadata.claude_session.session_id}\n` +
              `Path: ${worktree.worktreePath}\n\n` +
              `Claude CLI is now running in your terminal.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to resume Claude session: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;
