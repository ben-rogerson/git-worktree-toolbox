/**
 * Shared Constants - Configuration constants: metadata directory name, file paths, environment settings
 */

import * as os from "os";
import * as path from "path";

export const METADATA_DIR = "gwtree";

/**
 * Global configuration for git-worktree-toolbox
 * Loads from environment variables with sensible defaults
 */
export interface GlobalConfig {
  baseWorktreesPath: string;
  projectDirectories?: string[];
}

/**
 * Get the global configuration from environment variables
 */
export function getGlobalConfig(): GlobalConfig {
  const homeDir = os.homedir();

  // Default base worktrees path: ~/.gwtree/worktrees
  const baseWorktreesPath =
    process.env.BASE_WORKTREES_PATH || path.join(homeDir, ".gwtree");

  // Custom project directories (colon-separated)
  const projectDirectories =
    process.env.PROJECT_DIRECTORIES?.split(":").filter(Boolean);

  return {
    baseWorktreesPath,
    projectDirectories,
  };
}
