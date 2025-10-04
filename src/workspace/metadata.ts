/**
 * Workspace Metadata Management
 *
 * YAML-based metadata operations for workspace management:
 * - Create/load/save workspace metadata (task.config.yaml)
 * - Conversation history tracking for AI interactions
 * - Auto-commit status tracking (enabled, last commit, pending changes, queue size)
 * - Workspace lookups by ID or path
 * - Team member management (owners, collaborators)
 * - Git information tracking (base branch, current branch)
 *
 * Metadata is stored in .git/gwtree/task.config.yaml for each workspace.
 * All operations include Zod validation for type safety.
 */

import z from "zod";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { v4 as uuidv4 } from "uuid";
import {
  ensureDirectorySync,
  writeFileWithDirectorySync,
} from "@/src/utils/fs";
import { gitWorktreeList } from "@/src/utils/git";
import { METADATA_DIR } from "@/src/utils/constants";
import {
  WorktreeMetadata,
  ConversationEntry,
  CreateWorkspaceOptions,
} from "@/src/workspace/types";

export class WorkspaceMetadataManager {
  private static readonly METADATA_FILE = "task.config.yaml";

  private static async getWorktreeGitDir(
    worktreePath: string,
  ): Promise<string> {
    const gitFile = path.join(worktreePath, ".git");

    if (fs.existsSync(gitFile)) {
      const stats = fs.statSync(gitFile);

      if (stats.isFile()) {
        // Read the gitdir from the .git file
        const gitContent = fs.readFileSync(gitFile, "utf8").trim();
        const gitDirMatch = gitContent.match(/^gitdir:\s*(.+)$/);
        if (gitDirMatch) {
          return gitDirMatch[1].trim();
        }
      } else if (stats.isDirectory()) {
        // This is the main repo, use .git directly
        return gitFile;
      }
    }

    throw new Error(
      `Could not determine git directory for worktree: ${worktreePath}`,
    );
  }

  static async getMetadataPath(worktreePath: string): Promise<string> {
    const gitDir = await this.getWorktreeGitDir(worktreePath);
    return path.join(gitDir, METADATA_DIR, this.METADATA_FILE);
  }

  static async getMetadataDir(worktreePath: string): Promise<string> {
    const gitDir = await this.getWorktreeGitDir(worktreePath);
    return path.join(gitDir, METADATA_DIR);
  }

  static async createMetadata(
    worktreePath: string,
    options: Omit<CreateWorkspaceOptions, "channel_id"> & {
      worktree_name: string;
      branch: string;
    },
  ): Promise<WorktreeMetadata> {
    const metadataDir = await this.getMetadataDir(worktreePath);

    // Ensure metadata directory exists
    ensureDirectorySync(metadataDir);

    // Create initial metadata
    const metadata: WorktreeMetadata = {
      worktree: {
        id: uuidv4(),
        name: options.worktree_name,
        branch: options.branch,
        created_at: new Date().toISOString(),
        created_by: options.user_id || "anonymous",
        status: "active",
      },
      team: {
        assigned_users: options.user_id
          ? [
              {
                user_id: options.user_id,
                role: "owner",
                joined_at: new Date().toISOString(),
              },
            ]
          : [],
      },
      conversation_history: [
        {
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          user_id: options.user_id || "anonymous",
          prompt: options.task_description,
          claude_response: "Creating workspace for task...",
        },
      ],
      auto_commit: {
        enabled: true,
        last_commit: null,
        pending_changes: 0,
        queue_size: 0,
      },
      git_info: {
        base_branch: options.base_branch || "main",
        current_branch: options.branch,
      },
    };

    // Add auto-invited users
    if (options.auto_invite_users) {
      for (const userId of options.auto_invite_users) {
        if (userId !== options.user_id) {
          metadata.team.assigned_users.push({
            user_id: userId,
            role: "collaborator",
            joined_at: new Date().toISOString(),
          });
        }
      }
    }

    await this.saveMetadata(worktreePath, metadata);

    return metadata;
  }

  static async loadMetadata(
    worktreePath: string,
  ): Promise<WorktreeMetadata | null> {
    const metadataPath = await this.getMetadataPath(worktreePath);

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const yamlContent = fs.readFileSync(metadataPath, "utf8");
      const metadata = yaml.load(yamlContent) as WorktreeMetadata;
      // assert metadata items are not null using zod
      const parsedMetadata = z
        .object({
          worktree: z.object({
            id: z.string(),
            name: z.string(),
            branch: z.string(),
            created_at: z.string(),
            created_by: z.string(),
            status: z.enum(["active", "completed", "archived"]),
          }),
          team: z.object({
            assigned_users: z.array(
              z.object({
                user_id: z.string(),
                role: z.enum(["owner", "collaborator"]),
                joined_at: z.string(),
              }),
            ),
          }),
          conversation_history: z.array(
            z.object({
              id: z.string(),
              timestamp: z.string(),
              user_id: z.string().optional(),
              prompt: z.string(),
              claude_response: z.string(),
            }),
          ),
          auto_commit: z.object({
            enabled: z.boolean(),
            last_commit: z.string().nullable(),
            pending_changes: z.number(),
            queue_size: z.number(),
          }),
          git_info: z.object({
            base_branch: z.string(),
            current_branch: z.string(),
          }),
        })
        .parse(metadata);
      return parsedMetadata;
    } catch (error) {
      throw new Error(`Failed to parse metadata at ${metadataPath}: ${error}`);
    }
  }

  static async saveMetadata(
    worktreePath: string,
    metadata: WorktreeMetadata,
  ): Promise<void> {
    const metadataPath = await this.getMetadataPath(worktreePath);

    try {
      const yamlContent = yaml.dump(metadata, {
        indent: 2,
        lineWidth: 120,
        quotingType: '"',
      });
      writeFileWithDirectorySync(metadataPath, yamlContent, "utf8");
    } catch (error) {
      throw new Error(`Failed to save metadata to ${metadataPath}: ${error}`);
    }
  }

  static async addConversationEntry(
    worktreePath: string,
    entry: Omit<ConversationEntry, "id" | "timestamp">,
  ): Promise<void> {
    const metadata = await this.loadMetadata(worktreePath);
    if (!metadata) {
      throw new Error(`No metadata found for worktree at ${worktreePath}`);
    }

    const conversationEntry: ConversationEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    metadata.conversation_history.push(conversationEntry);
    await this.saveMetadata(worktreePath, metadata);
  }

  static async updateAutoCommitStatus(
    worktreePath: string,
    updates: Partial<WorktreeMetadata["auto_commit"]>,
  ): Promise<void> {
    const metadata = await this.loadMetadata(worktreePath);
    if (!metadata) {
      throw new Error(`No metadata found for worktree at ${worktreePath}`);
    }

    metadata.auto_commit = { ...metadata.auto_commit, ...updates };
    await this.saveMetadata(worktreePath, metadata);
  }

  static async getWorkspaceByTaskId(
    taskId: string,
    searchPath?: string,
  ): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    const baseDir = searchPath || process.cwd();
    const worktreesDir = path.join(baseDir, "worktrees");

    if (!fs.existsSync(worktreesDir)) {
      return null;
    }

    try {
      const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const worktreePath = path.join(worktreesDir, entry.name);
          const metadata = await this.loadMetadata(worktreePath);

          if (metadata && metadata.worktree.id === taskId) {
            return { worktreePath, metadata };
          }
        }
      }
    } catch (error) {
      console.warn(
        `Warning: Could not search worktrees in ${worktreesDir}: ${error}`,
      );
    }

    return null;
  }

  static async getWorkspaceByPathOrTaskId(
    pathOrTaskId: string,
    searchPath?: string,
  ): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    // First, check if it's a direct path to a workspace
    if (path.isAbsolute(pathOrTaskId) && fs.existsSync(pathOrTaskId)) {
      try {
        const metadata = await this.loadMetadata(pathOrTaskId);
        if (metadata) {
          return { worktreePath: pathOrTaskId, metadata };
        }
      } catch (error) {
        // Path exists but no metadata - return null so caller can handle appropriately
        console.warn(`Workspace at ${pathOrTaskId} exists but has no metadata`);
        return null;
      }
    }

    // If not a valid path, treat as task ID
    return await this.getWorkspaceByTaskId(pathOrTaskId, searchPath);
  }

  static async listAllWorkspaces(gitRepoPath?: string): Promise<
    Array<{
      worktreePath: string;
      metadata: WorktreeMetadata | null;
    }>
  > {
    const workspaces: Array<{
      worktreePath: string;
      metadata: WorktreeMetadata | null;
    }> = [];

    try {
      // Get actual git worktrees using git command
      const options = gitRepoPath ? { cwd: gitRepoPath } : {};
      const stdout = await gitWorktreeList(options);
      const lines = stdout.trim().split("\n");

      let currentWorktree = "";
      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          // Process previous worktree if we have one
          if (currentWorktree && fs.existsSync(currentWorktree)) {
            const metadata = await this.loadMetadata(currentWorktree);
            workspaces.push({ worktreePath: currentWorktree, metadata });
          }
          // Start new worktree
          currentWorktree = line.substring(9).trim();
        }
      }

      // Process the last worktree
      if (currentWorktree && fs.existsSync(currentWorktree)) {
        const metadata = await this.loadMetadata(currentWorktree);
        workspaces.push({ worktreePath: currentWorktree, metadata });
      }
    } catch (error) {
      console.warn(`Warning: Could not list git worktrees: ${error}`);
    }

    // Sort by creation date (newest first)
    return workspaces.sort(
      (a, b) =>
        new Date(b.metadata?.worktree?.created_at ?? "").getTime() -
        new Date(a.metadata?.worktree?.created_at ?? "").getTime(),
    );
  }
}
