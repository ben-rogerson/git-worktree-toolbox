import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { METADATA_DIR } from "../utils/constants";

export interface WorkspaceClaudeConfig {
  worktreePath: string;
  workspaceName: string;
  channelId: string | null;
  channelName: string | null;
}

const claudeTasksDir = path.join(os.homedir(), ".claude_tasks");

export class WorkspaceClaudeConfigGenerator {
  /**
   * Creates a Claude configuration file for a workspace with auto-commit hooks
   */
  static async createWorkspaceConfig(
    config: WorkspaceClaudeConfig,
  ): Promise<void> {
    const workspaceConfigDir = path.join(claudeTasksDir, config.workspaceName);
    const configPath = path.join(workspaceConfigDir, "settings.json");

    // Ensure .claude_tasks directory exists
    if (!fs.existsSync(claudeTasksDir)) {
      fs.mkdirSync(claudeTasksDir, { recursive: true });
    }

    // Ensure workspace-specific config directory exists
    if (!fs.existsSync(workspaceConfigDir)) {
      fs.mkdirSync(workspaceConfigDir, { recursive: true });
    }

    // Create workspace-specific auto-commit script
    const autoCommitScriptPath = path.join(
      workspaceConfigDir,
      "trigger-auto-commit.sh",
    );
    await this.createWorkspaceAutoCommitScript(
      autoCommitScriptPath,
      config.worktreePath,
      config.workspaceName,
    );

    // Create workspace-specific CLI
    const cliPath = path.join(workspaceConfigDir, "auto-commit-cli.js");
    await this.createWorkspaceCLI(cliPath);

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
                command: `"${autoCommitScriptPath}"`,
              },
              {
                type: "command",
                command: `osascript -e 'display notification "Claude finished working on ${config.workspaceName}" with title "✅ ${config.workspaceName} Complete" sound name "Glass"'`,
              },
            ],
          },
        ],
      },
    };

    // Write configuration file
    fs.writeFileSync(configPath, JSON.stringify(claudeConfig, null, 2));

    console.log(
      `Created Claude configuration for workspace: ${config.workspaceName}`,
    );
    console.log(`Config path: ${configPath}`);
  }

  /**
   * Creates a workspace-specific auto-commit script
   */
  private static async createWorkspaceAutoCommitScript(
    scriptPath: string,
    worktreePath: string,
    workspaceName: string,
  ): Promise<void> {
    const scriptContent = `#!/bin/bash

# Workspace-specific auto-commit script
# This script triggers auto-commit when Claude finishes working in this workspace

# Get the workspace directory
WORKSPACE_ROOT="${worktreePath}"

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Not in a git repository, skipping auto-commit"
    exit 0
fi

# Check if auto-commit is enabled for this workspace
METADATA_FILE="$WORKSPACE_ROOT/${METADATA_DIR}/task.config.yaml"
AUTO_COMMIT_ENABLED="true"  # Default to enabled

if [ -f "$METADATA_FILE" ]; then
    # Check if auto-commit is explicitly disabled in metadata
    AUTO_COMMIT_ENABLED=$(node -e "
    try {
        const metadata = JSON.parse(require('fs').readFileSync('$METADATA_FILE', 'utf8'));
        console.log(metadata.auto_commit?.enabled !== false ? 'true' : 'false');
    } catch (e) {
        console.log('true');
    }
    ")
fi

if [ "$AUTO_COMMIT_ENABLED" != "true" ]; then
    echo "Auto-commit disabled for this workspace"
    exit 0
fi

# Check if there are any changes to commit
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Changes detected in workspace, triggering auto-commit..."
    
    # Trigger auto-commit using the workspace-specific CLI
    node "$HOME/.claude_tasks/${workspaceName}/auto-commit-cli.js" force-commit "$WORKSPACE_ROOT"
else
    echo "No changes to commit in workspace"
fi
`;

    fs.writeFileSync(scriptPath, scriptContent);

    // Make script executable
    fs.chmodSync(scriptPath, "755");
  }

  /**
   * Creates a workspace-specific CLI for auto-commit
   */
  private static async createWorkspaceCLI(cliPath: string): Promise<void> {
    const cliContent = `#!/usr/bin/env node

/**
 * Workspace-specific CLI interface for auto-commit manager
 * This script triggers auto-commit for the specific workspace
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");

const execAsync = promisify(exec);

async function forceCommit(worktreePath) {
  try {
    // Check if there are any changes
    const { stdout: statusOutput } = await execAsync("git status --porcelain", {
      cwd: worktreePath,
    });
    if (!statusOutput.trim()) {
      console.log("No changes to commit");
      return;
    }

    // Count files changed
    const fileCount = statusOutput.trim().split("\\n").length;

    // Add all changes
    await execAsync("git add .", { cwd: worktreePath });

    // Commit with timestamp and workspace context
    const timestamp = new Date().toISOString();
    const workspaceName = path.basename(worktreePath);
    const commitMessage = \`Auto-commit: \${fileCount} files changed in \${workspaceName} at \${timestamp}\`;

    const { stdout: commitOutput } = await execAsync(
      \`git commit -m "\${commitMessage}"\`,
      { cwd: worktreePath }
    );

    // Extract commit hash
    const hashMatch = commitOutput.match(/\\[[\\w\\-\\/]+ ([a-f0-9]{7,})\\]/);
    const commitHash = hashMatch ? hashMatch[1] : "unknown";

    console.log(\`Auto-committed \${fileCount} changes in \${workspaceName}: \${commitHash}\`);

    // Try to push to remote
    try {
      await execAsync("git push", { cwd: worktreePath });
      console.log("Pushed to remote successfully");
    } catch (pushError) {
      console.log(
        "Push failed (this is normal if no remote is configured):",
        pushError.message
      );
    }
  } catch (error) {
    throw new Error(\`Auto-commit failed: \${error.message}\`);
  }
}

async function getStatus(worktreePath) {
  try {
    const { stdout: statusOutput } = await execAsync("git status --porcelain", {
      cwd: worktreePath,
    });
    const fileCount = statusOutput.trim()
      ? statusOutput.trim().split("\\n").length
      : 0;

    const { stdout: lastCommit } = await execAsync(
      'git log -1 --format="%H %ci"',
      { cwd: worktreePath }
    );

    return {
      pending_changes: fileCount,
      last_commit: lastCommit.trim(),
      has_changes: fileCount > 0,
      workspace: path.basename(worktreePath),
    };
  } catch (error) {
    throw new Error(\`Status check failed: \${error.message}\`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const worktreePath = args[1] || process.cwd();

  try {
    switch (command) {
      case "force-commit":
        console.log(\`Triggering auto-commit for workspace: \${worktreePath}\`);
        await forceCommit(worktreePath);
        console.log("Auto-commit completed successfully");
        break;

      case "status":
        const status = await getStatus(worktreePath);
        console.log("Auto-commit status:", JSON.stringify(status, null, 2));
        break;

      default:
        console.log("Usage: node auto-commit-cli.js <command> [worktree-path]");
        console.log("Commands:");
        console.log("  force-commit    - Force commit pending changes");
        console.log("  status         - Show commit queue status");
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
`;

    fs.writeFileSync(cliPath, cliContent);

    // Make CLI executable
    fs.chmodSync(cliPath, "755");
  }

  /**
   * Removes Claude configuration for a workspace
   */
  static async removeWorkspaceConfig(workspaceName: string): Promise<void> {
    const claudeTasksDir = path.join(os.homedir(), ".claude_tasks");
    const workspaceConfigDir = path.join(claudeTasksDir, workspaceName);

    if (fs.existsSync(workspaceConfigDir)) {
      fs.rmSync(workspaceConfigDir, { recursive: true, force: true });
      console.log(
        `Removed Claude configuration for workspace: ${workspaceName}`,
      );
    }
  }
}
