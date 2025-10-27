import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorktreeManager } from "../worktree/manager";
import * as gitOps from "../worktree/git-operations";
import { WorktreeMetadataManager } from "../worktree/metadata";
import type { WorktreeMetadata } from "../worktree/types";

vi.mock("../worktree/git-operations");
vi.mock("../worktree/metadata");
vi.mock("../tools/worktree-lifecycle");

const mockGitOps = vi.mocked(gitOps);
const mockMetadataManager = vi.mocked(WorktreeMetadataManager);

describe("WorktreeManager", () => {
  let manager: WorktreeManager;

  const mockMetadata: WorktreeMetadata = {
    worktree: {
      id: "task-123",
      name: "test-worktree",
      path: "/test/path",
      branch: "feature-branch",
      created_at: new Date().toISOString(),
      created_by: "user123",
      status: "active",
    },
    conversation_history: [],
    git_info: {
      base_branch: "main",
      current_branch: "feature-branch",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager({
      base_worktrees_path: "/base/worktrees",
      project_directories: ["/projects"],
    });

    mockGitOps.createWorkTree.mockResolvedValue({
      id: "wt-123",
      name: "test-worktree",
      path: "/test/path",
      branch: "feature-branch",
      created: new Date(),
    });

    mockMetadataManager.createMetadata.mockResolvedValue(mockMetadata);
    mockMetadataManager.getMetadataPath.mockReturnValue(
      "/metadata/task.config.yaml",
    );
    mockMetadataManager.addConversationEntry.mockResolvedValue();
  });

  describe("createWorktree", () => {
    it("should create worktree with all components", async () => {
      const result = await manager.createWorktree({
        task_description: "Implement new feature",
        base_branch: "main",
      });

      expect(mockGitOps.createWorkTree).toHaveBeenCalled();
      expect(mockMetadataManager.createMetadata).toHaveBeenCalled();
      expect(mockMetadataManager.addConversationEntry).toHaveBeenCalled();

      expect(result.task_id).toBe("task-123");
      expect(result.worktree_path).toBe("/test/path");
    });

    it("should pass git_repo_path to createWorkTree", async () => {
      await manager.createWorktree({
        task_description: "Test",
        git_repo_path: "/custom/repo",
      });

      expect(mockGitOps.createWorkTree).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        undefined,
        "/custom/repo",
      );
    });

    it("should preserve original error on failure", async () => {
      const originalError = new Error("Git operation failed");
      mockGitOps.createWorkTree.mockRejectedValue(originalError);

      await expect(
        manager.createWorktree({
          task_description: "Test",
        }),
      ).rejects.toThrow("Git operation failed");
    });
  });

  describe("getWorktreeByTaskId", () => {
    it("should return worktree when found", async () => {
      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue({
        worktreePath: "/test/path",
        metadata: mockMetadata,
      });

      const result = await manager.getWorktreeByTaskId("task-123");

      expect(result).not.toBeNull();
      expect(result?.metadata.worktree.id).toBe("task-123");
    });

    it("should return null when not found", async () => {
      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue(null);

      const result = await manager.getWorktreeByTaskId("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("archiveWorktreeByPathOrTaskId", () => {
    it("should archive worktree and clean up config", async () => {
      mockMetadataManager.getWorktreeByPathOrTaskId.mockResolvedValue({
        worktreePath: "/test/path",
        metadata: mockMetadata,
      });
      mockMetadataManager.saveMetadata.mockResolvedValue();

      await manager.archiveWorktreeByPathOrTaskId("task-123");

      expect(mockMetadataManager.saveMetadata).toHaveBeenCalledWith(
        "/test/path",
        expect.objectContaining({
          worktree: expect.objectContaining({ status: "archived" }),
        }),
      );
    });

    it("should throw error when worktree not found", async () => {
      mockMetadataManager.getWorktreeByPathOrTaskId.mockResolvedValue(null);

      await expect(
        manager.archiveWorktreeByPathOrTaskId("non-existent"),
      ).rejects.toThrow("No worktree found");
    });
  });

  describe("generateMRLinkByTaskId", () => {
    it("should generate GitLab MR link", async () => {
      const metadataWithGitLab: WorktreeMetadata = {
        ...mockMetadata,
        git_info: {
          ...mockMetadata.git_info,
          remote_url: "https://gitlab.com/org/repo",
        },
      };

      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue({
        worktreePath: "/test/path",
        metadata: metadataWithGitLab,
      });

      const link = await manager.generateMRLinkByTaskId("task-123");

      expect(link).toContain("gitlab.com");
      expect(link).toContain("merge_requests/new");
      expect(link).toContain("merge_request%5Bsource_branch%5D=feature-branch");
      expect(link).toContain("merge_request%5Btarget_branch%5D=main");
    });

    it("should generate GitHub PR link", async () => {
      const metadataWithGitHub: WorktreeMetadata = {
        ...mockMetadata,
        git_info: {
          ...mockMetadata.git_info,
          remote_url: "https://github.com/org/repo",
        },
      };

      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue({
        worktreePath: "/test/path",
        metadata: metadataWithGitHub,
      });

      const link = await manager.generateMRLinkByTaskId("task-123");

      expect(link).toContain("github.com");
      expect(link).toContain("compare/main...feature-branch");
    });

    it("should provide fallback message for unknown host", async () => {
      const metadataWithUnknownHost: WorktreeMetadata = {
        ...mockMetadata,
        git_info: {
          ...mockMetadata.git_info,
          remote_url: "https://unknown.com/org/repo",
        },
      };

      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue({
        worktreePath: "/test/path",
        metadata: metadataWithUnknownHost,
      });

      const link = await manager.generateMRLinkByTaskId("task-123");

      expect(link).toContain("Please create a merge request");
    });

    it("should provide fallback message when remote_url is missing", async () => {
      const metadataWithoutRemote: WorktreeMetadata = {
        ...mockMetadata,
        git_info: {
          ...mockMetadata.git_info,
          remote_url: undefined,
        },
      };

      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue({
        worktreePath: "/test/path",
        metadata: metadataWithoutRemote,
      });

      const link = await manager.generateMRLinkByTaskId("task-123");

      expect(link).toContain("No remote URL found");
      expect(link).toContain("test-worktree");
    });

    it("should throw error when worktree not found", async () => {
      mockMetadataManager.getWorktreeByTaskId.mockResolvedValue(null);

      await expect(
        manager.generateMRLinkByTaskId("non-existent"),
      ).rejects.toThrow("No worktree found for task");
    });
  });
});
