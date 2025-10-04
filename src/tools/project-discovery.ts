/**
 * Project Discovery Tools - MCP tools for discovering git repositories:
 * list projects (listProjects), generate MR link (generateMrLink)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { autoCommitManager } from "@/src/workspace/auto-commit";
import type { McpTool } from "@/src/tools/types";
import type { WorkspaceManager } from "@/src/workspace/manager";

// ============================================================================
// Types
// ============================================================================

interface DiscoveredProject {
  name: string;
  path: string;
  hasWorktrees: boolean;
}

// ============================================================================
// Project Discovery Utilities
// ============================================================================

/**
 * Get the default project directories to scan
 */
function getDefaultProjectDirectories(): string[] {
  const homeDir = os.homedir();
  return [
    path.join(homeDir, "Projects"),
    path.join(homeDir, "Code"),
    path.join(homeDir, "Developer"),
  ];
}

/**
 * Get all directories to scan (default + custom)
 */
function getScannedDirectories(customDirectories?: string[]): string[] {
  const defaultDirs = getDefaultProjectDirectories();
  if (!customDirectories || customDirectories.length === 0) {
    return defaultDirs;
  }
  return [...defaultDirs, ...customDirectories];
}

/**
 * Check if a directory is a git repository
 */
function isGitRepository(dirPath: string): boolean {
  try {
    const gitDir = path.join(dirPath, ".git");
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

/**
 * Check if a git repository has worktrees
 */
function hasWorktrees(gitDir: string): boolean {
  try {
    const worktreesDir = path.join(gitDir, ".git", "worktrees");
    return fs.existsSync(worktreesDir);
  } catch {
    return false;
  }
}

/**
 * Check if a directory should be ignored during recursive scanning
 */
function shouldIgnoreDirectory(dirName: string): boolean {
  const ignorePatterns = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    ".nyc_output",
    "target", // Rust
    "vendor", // Go
    ".venv", // Python
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".DS_Store",
    "Thumbs.db",
    ".vscode",
    ".idea",
    ".vs",
    "tmp",
    "temp",
    ".tmp",
    ".temp",
    "logs",
    ".logs",
    "cache",
    ".cache",
    ".parcel-cache",
    ".turbo",
    ".eslintcache",
    ".stylelintcache",
    "bower_components",
    ".sass-cache",
    ".gradle",
    ".mvn",
    "bin",
    "obj",
    "packages", // Common in monorepos but might contain projects
  ];

  return ignorePatterns.includes(dirName) || dirName.startsWith(".");
}

/**
 * Recursively discover git repositories in a directory
 */
function discoverProjectsRecursively(
  dirPath: string,
  maxDepth: number = 3,
  currentDepth: number = 0,
): DiscoveredProject[] {
  const projects: DiscoveredProject[] = [];

  // Prevent infinite recursion
  if (currentDepth >= maxDepth) {
    return projects;
  }

  if (!fs.existsSync(dirPath)) {
    return projects;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      // Skip ignored directories
      if (shouldIgnoreDirectory(entry.name)) {
        continue;
      }

      const projectPath = path.join(dirPath, entry.name);

      // Check if this directory is a git repository
      if (isGitRepository(projectPath)) {
        projects.push({
          name: entry.name,
          path: projectPath,
          hasWorktrees: hasWorktrees(projectPath),
        });
      } else {
        // Recursively scan subdirectories
        const subProjects = discoverProjectsRecursively(
          projectPath,
          maxDepth,
          currentDepth + 1,
        );
        projects.push(...subProjects);
      }
    }
  } catch (error) {
    // Skip directories we can't read
    console.warn(`Failed to scan directory ${dirPath}:`, error);
  }

  return projects;
}

/**
 * Discover all git repositories in specified directories
 */
function discoverProjects(customDirectories?: string[]): DiscoveredProject[] {
  const directories = getScannedDirectories(customDirectories);
  const projects: DiscoveredProject[] = [];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    // Use recursive discovery instead of just top-level scanning
    const dirProjects = discoverProjectsRecursively(dir);
    projects.push(...dirProjects);
  }

  return projects;
}

export const listProjects = {
  name: "list projects",
  description:
    "Discover all git repositories in configured project directories. Recursively scans ~/Projects, ~/Code, ~/Developer by default (up to 3 levels deep), plus any custom directories configured. Ignores common build/cache directories like node_modules, dist, .git, etc.",
  parameters: () => ({}),
  cb: async (
    _args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => {
    try {
      // Get configured directories from workspace manager
      const configuredDirectories = workspaceManager.projectDirectories;

      const projects = discoverProjects(configuredDirectories);
      const scannedDirs = getScannedDirectories(configuredDirectories);

      if (projects.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                `📂 **No Projects Found**\n\n` +
                `Scanned directories:\n` +
                scannedDirs.map((dir) => `  • ${dir}`).join("\n") +
                `\n\nNo git repositories were found in these locations.\n\n` +
                `💡 To scan additional directories, configure the \`project_directories\` option in your MCP server config.`,
            },
          ],
        };
      }

      const projectsWithWorktrees = projects.filter((p) => p.hasWorktrees);
      const projectsWithoutWorktrees = projects.filter((p) => !p.hasWorktrees);

      let text = `📂 **Discovered Projects (${projects.length} total)**\n\n`;

      text += `**Scanned directories:**\n`;
      text += scannedDirs.map((dir) => `  • ${dir}`).join("\n") + "\n\n";

      if (projectsWithWorktrees.length > 0) {
        text += `**Projects with workspaces (${projectsWithWorktrees.length}):**\n`;
        for (const project of projectsWithWorktrees) {
          text += `  ✅ **${project.name}**\n`;
          text += `     • Path: ${project.path}\n`;
        }
        text += "\n";
      }

      if (projectsWithoutWorktrees.length > 0) {
        text += `**Projects without workspaces (${projectsWithoutWorktrees.length}):**\n`;
        for (const project of projectsWithoutWorktrees) {
          text += `  📦 **${project.name}**\n`;
          text += `     • Path: ${project.path}\n`;
        }
        text += "\n";
      }

      text += `💡 Use the "list workspaces" tool with a project path to see existing workspaces.\n`;
      text += `💡 Use the "create workspace" tool with a project path to create a new workspace.`;

      return {
        content: [{ type: "text", text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to discover projects: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;

export const generateMrLink = {
  name: "generate mr link",
  description: "Generate a merge request link for a workspace",
  parameters: (z) => ({
    task_id: z.string().describe("Task ID of the workspace"),
  }),
  cb: async (
    args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => {
    try {
      const taskId = args.task_id as string;

      // Force commit any pending changes first
      const workspace = await workspaceManager.getWorkspaceByTaskId(taskId);
      if (workspace) {
        await autoCommitManager.forceCommit(workspace.worktreePath);
      }

      const mrLink = await workspaceManager.generateMRLinkByTaskId(taskId);

      return {
        content: [
          {
            type: "text",
            text:
              `🔀 **Merge Request Ready**\n\n` +
              `All changes have been automatically committed and pushed.\n\n` +
              `**Create your MR here:** ${mrLink}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to generate MR link: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
} satisfies McpTool;
