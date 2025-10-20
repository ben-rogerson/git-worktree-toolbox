/**
 * Project Discovery Tools - MCP tools for discovering git repositories:
 * list projects (listProjects), generate MR link (generateMrLink)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { McpTool } from "@/src/tools/types";
import type { WorktreeManager } from "@/src/worktree/manager";
import { WorktreeMetadataManager } from "@/src/worktree/metadata";
import type { WorktreeMetadata } from "@/src/worktree/types";
import { ensureWorktreeHasMetadata } from "./worktree-lifecycle";
import { detectWorktreeOwnerRepo } from "@/src/utils/git";
import { sharedParameters } from "./utils";

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
 * Get all directories to scan (override defaults with custom if provided)
 */
function getScannedDirectories(customDirectories?: string[]): string[] {
  if (!customDirectories || customDirectories.length === 0) {
    return getDefaultProjectDirectories();
  }
  return customDirectories;
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

function buildAllReposHeader(
  projects: DiscoveredProject[],
  scannedDirs: string[],
  worktreeManager: WorktreeManager,
): string {
  const scannedDirsList = scannedDirs.map((dir) => `  • ${dir}`).join("\n");
  const configuredDirectories = worktreeManager.projectDirectories;
  const directoryTip =
    configuredDirectories && configuredDirectories.length > 0
      ? `💡 PROJECT_DIRECTORIES has been set.`
      : `💡 Set dirs with the PROJECT_DIRECTORIES env var\neg: \`export PROJECT_DIRECTORIES="$HOME/Projects:$HOME/Code"\`.`;

  return `📂 Discovered Projects (${projects.length} total)

Scanned directories:
${scannedDirsList}

${directoryTip}

`;
}

function buildCurrentRepoHeader(repoPath: string): string {
  return `🌳 Current Repository Worktrees

Repository: ${repoPath}
💡 Use -a or --all flag to show all repositories

`;
}

async function buildWorktreesSection(
  projectsWithWorktrees: DiscoveredProject[],
): Promise<string> {
  if (projectsWithWorktrees.length === 0) {
    return `No projects with worktrees found.\n`;
  }

  const projectSections = await Promise.all(
    projectsWithWorktrees.map((project) => buildProjectSection(project)),
  );

  return `Projects with worktrees (${projectsWithWorktrees.length}):
${projectSections.join("")}
`;
}

async function buildProjectSection(
  project: DiscoveredProject,
): Promise<string> {
  const worktreesList = await buildWorktreesList(project.path);

  return `  ✅ ${project.name}
     • Path: ${project.path}
${worktreesList}`;
}

async function buildWorktreesList(projectPath: string): Promise<string> {
  try {
    const worktrees =
      await WorktreeMetadataManager.listAllWorktrees(projectPath);

    if (worktrees.length === 0) {
      return "";
    }

    const worktreeEntries = worktrees.map((wt) => buildWorktreeEntry(wt));

    return `     • Worktrees (${worktrees.length}):
${worktreeEntries.join("")}`;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return `     • Error loading worktrees: ${errorMessage}\n`;
  }
}

function buildWorktreeEntry(wt: {
  worktreePath: string;
  metadata: WorktreeMetadata | null;
}): string {
  const labels = [];
  if (wt.worktreePath === process.cwd()) {
    labels.push("current");
  }
  const labelSuffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";

  if (wt.metadata) {
    return `       - ${wt.metadata.worktree.name}${labelSuffix} (${wt.metadata.worktree.branch})\n`;
  }

  const pathParts = wt.worktreePath.split("/");
  const folderName = pathParts[pathParts.length - 1];
  return `       - ${folderName}${labelSuffix} (no metadata)\n`;
}

export const listProjects = {
  name: "list",
  description: "Show git repositories with worktrees",
  cli: {
    aliases: ["list"],
    flags: [
      {
        param: "all",
        alias: "a",
        description: "Show all worktrees across all repositories",
      },
    ],
  },
  cliFooter:
    "💡 Run `gwtree changes <identifier>` to see changes in a worktree\n💡 Run `gwtree create <description>` to create a new worktree",
  mcpFooter:
    '💡 Use the "changes" tool with a worktree identifier to see detailed changes\n💡 Use the "create" tool to create a new worktree for a task',
  parameters: (z) => ({
    all: z
      .boolean()
      .optional()
      .describe("Show all worktrees across all repositories"),
  }),
  cb: async (
    _args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { all } = _args as { all?: boolean };

    try {
      // Check if we're currently in a git repository
      const currentDir = process.cwd();
      const isInGitRepo = isGitRepository(currentDir);
      const ownerRepo = await detectWorktreeOwnerRepo(currentDir);

      let projects: DiscoveredProject[];
      let scannedDirs: string[];
      let showAllRepos = false;

      const isOutsideGitRepo = !isInGitRepo && !ownerRepo;
      const shouldShowAllRepos = isOutsideGitRepo || all;

      if (shouldShowAllRepos) {
        showAllRepos = true;
        const configuredDirectories = worktreeManager.projectDirectories;
        projects = discoverProjects(configuredDirectories);
        scannedDirs = getScannedDirectories(configuredDirectories);
      } else {
        const repoPath = ownerRepo || currentDir;
        const projectName = path.basename(repoPath);
        projects = [
          {
            name: projectName,
            path: repoPath,
            hasWorktrees: hasWorktrees(repoPath),
          },
        ];
        scannedDirs = [repoPath];
      }

      // Ensure all worktrees in discovered projects have metadata
      for (const project of projects) {
        if (project.hasWorktrees) {
          try {
            const worktrees = await WorktreeMetadataManager.listAllWorktrees(
              project.path,
            );
            const worktreePaths = worktrees.map((w) => w.worktreePath);
            await WorktreeMetadataManager.ensureMetadataForWorktrees(
              worktreePaths,
              ensureWorktreeHasMetadata,
            );
          } catch (error) {
            console.warn(
              `Failed to ensure metadata for worktrees in ${project.name}:`,
              error,
            );
          }
        }
      }

      if (projects.length === 0) {
        // Check if custom directories are being used
        const configuredDirectories = worktreeManager.projectDirectories;
        const tipMessage =
          configuredDirectories && configuredDirectories.length > 0
            ? `💡 PROJECT_DIRECTORIES has been set.`
            : `💡 Set dirs with the PROJECT_DIRECTORIES env var\neg: \`export PROJECT_DIRECTORIES="$HOME/Projects:$HOME/Code"\`.`;

        return {
          content: [
            {
              type: "text",
              text:
                `📂 No Projects Found\n\n` +
                `Scanned directories:\n` +
                scannedDirs.map((dir) => `  • ${dir}`).join("\n") +
                `\n\nNo git repositories were found in these locations.\n\n` +
                tipMessage,
            },
          ],
        };
      }

      const projectsWithWorktrees = projects.filter((p) => p.hasWorktrees);

      const headerSection = showAllRepos
        ? buildAllReposHeader(projects, scannedDirs, worktreeManager)
        : buildCurrentRepoHeader(ownerRepo || currentDir);

      const worktreesSection = await buildWorktreesSection(
        projectsWithWorktrees,
      );

      const text = `${headerSection}${worktreesSection}`;

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
  name: "mr",
  description: "Generate a merge request link for a worktree",
  cli: {
    aliases: ["mr"],
    flags: [
      {
        param: "worktree_identifier",
        alias: "i",
        description: "Worktree identifier",
      },
    ],
  },
  cliFooter:
    "💡 Run `gwtree changes <identifier>` to see what changes will be in the MR\n💡 Run `gwtree list` to see all available worktrees",
  mcpFooter:
    '💡 Use the "changes" tool to see what changes will be in the merge request\n💡 Use the "list" tool to see all available worktrees',
  parameters: (z) => ({
    worktree_identifier: sharedParameters.worktree_identifier(z),
  }),
  cb: async (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => {
    const { worktree_identifier } = args as {
      worktree_identifier?: string;
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

    try {
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

      const mrLink =
        await worktreeManager.generateMRLinkByPathOrTaskId(worktree_identifier);

      return {
        content: [
          {
            type: "text",
            text:
              `🔀 Merge Request Ready\n\n` + `Create your MR here: ${mrLink}`,
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
