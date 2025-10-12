/**
 * Worktree Metadata Management
 *
 * YAML-based metadata operations for worktree management:
 * - Create/load/save worktree metadata (task.config.yaml)
 * - Conversation history tracking for AI interactions
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
  ensureWorktreesReadme,
} from "@/src/utils/fs";
import { gitWorktreeList } from "@/src/utils/git";
import {
  WorktreeMetadata,
  ConversationEntry,
  CreateWorktreeOptions,
} from "@/src/worktree/types";
import { getGlobalConfig } from "@/src/utils/constants";

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
      response: z.string(),
    }),
  ),
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

    // Ensure worktrees README exists
    const { baseWorktreesPath } = getGlobalConfig();
    ensureWorktreesReadme(baseWorktreesPath);

    // Create initial metadata
    const metadata: WorktreeMetadata = {
      worktree: {
        id: uuidv4(),
        name: options.worktree_name,
        path: path.resolve(worktreePath),
        branch: options.branch,
        created_at: new Date().toISOString(),
        created_by: "system",
        status: "active",
      },
      team: {
        assigned_users: [],
      },
      conversation_history: [],
      git_info: {
        base_branch: options.base_branch || "main",
        current_branch: options.branch,
      },
    };

    // Add auto-invited users
    if (options.auto_invite_users) {
      for (const userId of options.auto_invite_users) {
        metadata.team.assigned_users.push({
          user_id: userId,
          role: "collaborator",
          joined_at: new Date().toISOString(),
        });
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
      console.warn(
        `Warning: Could not parse metadata at ${metadataPath}: ${error}`,
      );
      console.warn("Attempting to repair corrupted metadata...");

      try {
        const repairedMetadata = await this.repairMetadata(
          worktreePath,
          metadataPath,
        );
        if (repairedMetadata) {
          console.warn("Successfully repaired and saved metadata");
          return repairedMetadata;
        }
      } catch (repairError) {
        console.warn(`Failed to repair metadata: ${repairError}`);
      }

      // If repair fails, return null to indicate no valid metadata
      return null;
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
   * Repair corrupted metadata by extracting valid data and reconstructing missing parts
   */
  static async repairMetadata(
    worktreePath: string,
    metadataPath: string,
  ): Promise<WorktreeMetadata | null> {
    try {
      const yamlContent = fs.readFileSync(metadataPath, "utf8");
      const rawMetadata = yaml.load(yamlContent) as Record<string, unknown>;

      // Extract valid data from the corrupted metadata
      const worktreeName = path.basename(worktreePath);
      const worktreeId = (rawMetadata.worktree as any)?.id || uuidv4();
      const createdBy = (rawMetadata.worktree as any)?.created_by || "system";
      const createdAt =
        (rawMetadata.worktree as any)?.created_at || new Date().toISOString();
      const status = (rawMetadata.worktree as any)?.status || "active";

      // Get current branch
      let currentBranch = "main";
      try {
        const { gitCurrentBranch } = await import("@/src/utils/git");
        currentBranch = await gitCurrentBranch({ cwd: worktreePath });
      } catch {
        // Default to main if we can't determine
      }

      // Repair conversation history by fixing malformed entries
      const conversationHistory: ConversationEntry[] = [];
      const rawConversations =
        (rawMetadata.conversation_history as any[]) || [];

      for (const rawConv of rawConversations) {
        if (rawConv && typeof rawConv === "object") {
          // Fix entries that have claude_response instead of response
          const response = rawConv.response || rawConv.claude_response || "";

          if (rawConv.id && rawConv.timestamp && rawConv.prompt && response) {
            conversationHistory.push({
              id: rawConv.id,
              timestamp: rawConv.timestamp,
              user_id: rawConv.user_id,
              prompt: rawConv.prompt,
              response: response,
            });
          }
        }
      }

      // Extract team information
      const assignedUsers = (rawMetadata.team as any)?.assigned_users || [];
      const validTeamMembers = assignedUsers.filter(
        (user: any) => user && user.user_id && user.role && user.joined_at,
      );

      // If no valid team members, add the creator
      if (validTeamMembers.length === 0) {
        validTeamMembers.push({
          user_id: createdBy,
          role: "owner",
          joined_at: createdAt,
        });
      }

      // Extract git info
      const gitInfoRaw = rawMetadata.git_info as any;
      const gitInfo = {
        base_branch: gitInfoRaw?.base_branch || "main",
        current_branch: currentBranch,
      };

      // Reconstruct the metadata
      const repairedMetadata: WorktreeMetadata = {
        worktree: {
          id: worktreeId,
          name: worktreeName,
          path: worktreePath,
          branch: currentBranch,
          created_at: createdAt,
          created_by: createdBy,
          status: status,
        },
        team: {
          assigned_users: validTeamMembers,
        },
        conversation_history: conversationHistory,
        git_info: gitInfo,
      };

      // Validate the repaired metadata
      const validatedMetadata =
        WORKTREE_METADATA_SCHEMA.parse(repairedMetadata);

      // Save the repaired metadata
      await this.saveMetadata(worktreePath, validatedMetadata);

      return validatedMetadata;
    } catch (error) {
      throw new Error(`Failed to repair metadata: ${error}`);
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
    // Default to current working directory if not provided
    const identifier = pathOrTaskId || process.cwd();

    // First, check if it's a direct path to a worktree
    if (path.isAbsolute(identifier) && fs.existsSync(identifier)) {
      try {
        const metadata = await this.loadMetadata(identifier);
        if (metadata) {
          return { worktreePath: identifier, metadata };
        }
      } catch (error) {
        // Path exists but no metadata - return null so caller can handle appropriately
        console.warn(`Worktree at ${identifier} exists but has no metadata`);
        return null;
      }
    }

    // Try to find by task ID (UUID)
    const byTaskId = await this.getWorktreeByTaskId(identifier, searchPath);
    if (byTaskId) {
      return byTaskId;
    }

    // Try to find by worktree name or branch name
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

              // Check by worktree name
              if (metadata.worktree.name === identifier) {
                return { worktreePath: metadata.worktree.path, metadata };
              }

              // Check by branch name
              if (metadata.worktree.branch === identifier) {
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
