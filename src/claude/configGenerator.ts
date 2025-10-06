import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface WorktreeClaudeConfig {
  worktreePath: string;
  worktreeName: string;
  channelId: string | null;
  channelName: string | null;
}

const claudeTasksDir = path.join(os.homedir(), ".claude_tasks");

export class WorktreeClaudeConfigGenerator {
  /**
   * Creates a Claude configuration file for a worktree
   */
  static async createWorktreeConfig(
    config: WorktreeClaudeConfig,
  ): Promise<void> {
    const worktreeConfigDir = path.join(claudeTasksDir, config.worktreeName);
    const configPath = path.join(worktreeConfigDir, "settings.json");

    // Ensure .claude_tasks directory exists
    if (!fs.existsSync(claudeTasksDir)) {
      fs.mkdirSync(claudeTasksDir, { recursive: true });
    }

    // Ensure worktree-specific config directory exists
    if (!fs.existsSync(worktreeConfigDir)) {
      fs.mkdirSync(worktreeConfigDir, { recursive: true });
    }

    // Create Claude configuration with hooks
    const claudeConfig = {
      permissions: {
        allow: [
          "Bash(git init:*)",
          "Bash(git add:*)",
          "Bash(git commit:*)",
          "Bash(git status:*)",
          "Bash(git diff:*)",
          "Bash(git push:*)",
          "Bash(git pull:*)",
          "Bash(git log:*)",
          "Bash(npm:*)",
          "Bash(npx:*)",
          "Bash(node:*)",
          "Bash(touch:*)",
          "Bash(cp:*)",
          "Bash(rm:*)",
          "Bash(mkdir:*)",
          "Bash(find:*)",
          "Bash(grep:*)",
          "Bash(cat:*)",
          "Bash(echo:*)",
          "Bash(ls:*)",
          "Bash(cd:*)",
          "Bash(pwd:*)",
          "WebFetch(domain:docs.anthropic.com)",
          "WebFetch(domain:github.com)",
          "WebFetch(domain:npmjs.com)",
          "mcp__context7__resolve-library-id",
          "mcp__context7__get-library-docs",
        ],
        deny: [],
        defaultMode: "bypassPermissions",
      },
      enableAllProjectMcpServers: true,
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
              },
              {
                type: "command",
                command: `osascript -e 'display notification "Claude finished working on ${config.worktreeName}" with title "✅ ${config.worktreeName} Complete" sound name "Glass"'`,
              },
            ],
          },
        ],
      },
    };

    // Write configuration file
    fs.writeFileSync(configPath, JSON.stringify(claudeConfig, null, 2));

    console.log(
      `Created Claude configuration for worktree: ${config.worktreeName}`,
    );
    console.log(`Config path: ${configPath}`);
  }

  /**
   * Removes Claude configuration for a worktree
   */
  static async removeWorktreeConfig(worktreeName: string): Promise<void> {
    const claudeTasksDir = path.join(os.homedir(), ".claude_tasks");
    const worktreeConfigDir = path.join(claudeTasksDir, worktreeName);

    if (fs.existsSync(worktreeConfigDir)) {
      fs.rmSync(worktreeConfigDir, { recursive: true, force: true });
      console.log(`Removed Claude configuration for worktree: ${worktreeName}`);
    }
  }
}
