/**
 * Worktree Metadata Management
 *
 * YAML-based metadata operations for worktree management:
 * - Create/load/save worktree metadata (task.config.yaml)
 * - Conversation history tracking for AI interactions
 * - Auto-commit status tracking (enabled, last commit, pending changes, queue size)
 * - Worktree lookups by ID or path
 * - Team member management (owners, collaborators)
 * - Git information tracking (base branch, current branch)
 *
 * Metadata is stored centrally at ~/.gwtree/metadata/<hash>/task.config.yaml
 * where <hash> is a SHA256 of the absolute worktree path.
 * All operations include Zod validation for type safety.
 */

import z from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import {
  ensureDirectorySync,
  writeFileWithDirectorySync,
} from "@/src/utils/fs";
import { gitWorktreeList } from "@/src/utils/git";
import {
  WorktreeMetadata,
  ConversationEntry,
  CreateWorktreeOptions,
} from "@/src/worktree/types";

const WORKTREE_METADATA_SCHEMA = z.object({
  worktree: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
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
});

export class WorktreeMetadataManager {
  private static readonly METADATA_FILE = "task.config.yaml";
  private static readonly METADATA_ROOT = path.join(
    os.homedir(),
    ".gwtree",
    "metadata",
  );

  /**
   * Generate a deterministic hash from a worktree path for storage
   */
  private static hashPath(worktreePath: string): string {
    return crypto.createHash("sha256").update(worktreePath).digest("hex");
  }

  /**
   * Get the metadata directory for a worktree by path hash
   */
  static getMetadataDir(worktreePath: string): string {
    const hash = this.hashPath(path.resolve(worktreePath));
    return path.join(this.METADATA_ROOT, hash);
  }

  /**
   * Get the metadata file path for a worktree
   */
  static getMetadataPath(worktreePath: string): string {
    return path.join(this.getMetadataDir(worktreePath), this.METADATA_FILE);
  }

  static async createMetadata(
    worktreePath: string,
    options: Omit<CreateWorktreeOptions, "channel_id"> & {
      worktree_name: string;
      branch: string;
    },
  ): Promise<WorktreeMetadata> {
    const metadataDir = this.getMetadataDir(worktreePath);

    // Ensure metadata directory exists
    ensureDirectorySync(metadataDir);

    // Create initial metadata
    const metadata: WorktreeMetadata = {
      worktree: {
        id: uuidv4(),
        name: options.worktree_name,
        path: path.resolve(worktreePath),
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
          claude_response: "Creating worktree for task...",
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
    const metadataPath = this.getMetadataPath(worktreePath);

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const yamlContent = fs.readFileSync(metadataPath, "utf8");
      const metadata = yaml.load(yamlContent) as WorktreeMetadata;
      const parsedMetadata = WORKTREE_METADATA_SCHEMA.parse(metadata);
      return parsedMetadata;
    } catch (error) {
      throw new Error(`Failed to parse metadata at ${metadataPath}: ${error}`);
    }
  }

  static async saveMetadata(
    worktreePath: string,
    metadata: WorktreeMetadata,
  ): Promise<void> {
    const metadataPath = this.getMetadataPath(worktreePath);

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

  /**
   * Delete metadata file for a worktree
   * Use when worktree is permanently removed
   */
  static deleteMetadata(worktreePath: string): void {
    const metadataDir = this.getMetadataDir(worktreePath);

    if (!fs.existsSync(metadataDir)) {
      return;
    }

    try {
      fs.rmSync(metadataDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to delete metadata at ${metadataDir}: ${error}`);
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

  static async getWorktreeByTaskId(
    taskId: string,
    _searchPath?: string,
  ): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    // Scan all metadata files to find matching task ID
    if (!fs.existsSync(this.METADATA_ROOT)) {
      return null;
    }

    try {
      const metadataDirs = fs.readdirSync(this.METADATA_ROOT, {
        withFileTypes: true,
      });

      for (const dir of metadataDirs) {
        if (dir.isDirectory()) {
          const metadataPath = path.join(
            this.METADATA_ROOT,
            dir.name,
            this.METADATA_FILE,
          );

          if (fs.existsSync(metadataPath)) {
            try {
              const yamlContent = fs.readFileSync(metadataPath, "utf8");
              const metadata = yaml.load(yamlContent) as WorktreeMetadata;

              if (metadata.worktree.id === taskId) {
                return { worktreePath: metadata.worktree.path, metadata };
              }
            } catch (error) {
              console.warn(
                `Failed to parse metadata at ${metadataPath}: ${error}`,
              );
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to scan metadata directory: ${error}`);
    }

    return null;
  }

  static async getWorktreeByPathOrTaskId(
    pathOrTaskId: string,
    searchPath?: string,
  ): Promise<{
    worktreePath: string;
    metadata: WorktreeMetadata;
  } | null> {
    // First, check if it's a direct path to a worktree
    if (path.isAbsolute(pathOrTaskId) && fs.existsSync(pathOrTaskId)) {
      try {
        const metadata = await this.loadMetadata(pathOrTaskId);
        if (metadata) {
          return { worktreePath: pathOrTaskId, metadata };
        }
      } catch (error) {
        // Path exists but no metadata - return null so caller can handle appropriately
        console.warn(`Worktree at ${pathOrTaskId} exists but has no metadata`);
        return null;
      }
    }

    // If not a valid path, treat as task ID
    return await this.getWorktreeByTaskId(pathOrTaskId, searchPath);
  }

  static async listAllWorktrees(gitRepoPath?: string): Promise<
    Array<{
      worktreePath: string;
      metadata: WorktreeMetadata | null;
    }>
  > {
    const worktrees: Array<{
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
            worktrees.push({ worktreePath: currentWorktree, metadata });
          }
          // Start new worktree
          currentWorktree = line.substring(9).trim();
        }
      }

      // Process the last worktree
      if (currentWorktree && fs.existsSync(currentWorktree)) {
        const metadata = await this.loadMetadata(currentWorktree);
        worktrees.push({ worktreePath: currentWorktree, metadata });
      }
    } catch (error) {
      console.warn(`Warning: Could not list git worktrees: ${error}`);
    }

    // Sort by creation date (newest first)
    return worktrees.sort(
      (a, b) =>
        new Date(b.metadata?.worktree?.created_at ?? "").getTime() -
        new Date(a.metadata?.worktree?.created_at ?? "").getTime(),
    );
  }

  /**
   * Ensure metadata exists for multiple worktrees in parallel
   * Returns lists of succeeded and failed worktrees
   */
  static async ensureMetadataForWorktrees(
    worktreePaths: string[],
    ensureMetadataFn: (path: string) => Promise<void>,
  ): Promise<{
    succeeded: string[];
    failed: Array<{ path: string; error: string }>;
  }> {
    const results = await Promise.allSettled(
      worktreePaths.map(async (worktreePath) => {
        const existing = await this.loadMetadata(worktreePath);
        if (!existing) {
          await ensureMetadataFn(worktreePath);
        }
        return worktreePath;
      }),
    );

    const succeeded: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
      } else {
        failed.push({
          path: worktreePaths[idx],
          error: result.reason.message,
        });
      }
    });

    return { succeeded, failed };
  }
}
