import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanWorktrees } from "../tools/worktree-lifecycle";
import { WorktreeManager } from "../worktree/manager";
import { WorktreeMetadataManager } from "../worktree/metadata";
import * as gitUtils from "../utils/git";
import type { WorktreeMetadata } from "../worktree/types";

// Mock dependencies
vi.mock("../worktree/metadata");
vi.mock("../utils/git");
vi.mock("../tools/utils");

const mockMetadataManager = vi.mocked(WorktreeMetadataManager);
const mockGitUtils = vi.mocked(gitUtils);

describe("cleanWorktrees", () => {
  let mockWorktreeManager: WorktreeManager;

  const mockWorktreeMetadata: WorktreeMetadata = {
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

  const mockMainWorktreeMetadata: WorktreeMetadata = {
    ...mockWorktreeMetadata,
    worktree: {
      ...mockWorktreeMetadata.worktree,
      branch: "main",
    },
    git_info: {
      base_branch: "main",
      current_branch: "main",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorktreeManager = {
      archiveWorktreeByPathOrTaskId: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Default mock implementations
    mockMetadataManager.listAllWorktrees.mockResolvedValue([]);
    mockGitUtils.gitCurrentBranch.mockResolvedValue("main");
    mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
    mockGitUtils.gitDiffStats.mockResolvedValue({
      files: 0,
      insertions: 0,
      deletions: 0,
    });
  });

  describe("basic functionality", () => {
    it("should return no worktrees message when no worktrees found", async () => {
      mockMetadataManager.listAllWorktrees.mockResolvedValue([]);

      const result = await cleanWorktrees.cb(
        {},
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("No worktrees found to clean");
    });

    it("should handle dry run mode", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "Dry run mode - no workspaces were actually archived",
      );
      expect(
        mockWorktreeManager.archiveWorktreeByPathOrTaskId,
      ).not.toHaveBeenCalled();
    });
  });

  describe("main workspace protection", () => {
    it("should never archive main workspace (main branch)", async () => {
      const worktrees = [
        {
          worktreePath: "/test/main",
          metadata: mockMainWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.getDefaultBranch.mockResolvedValue("main");
      mockGitUtils.gitCurrentBranch.mockResolvedValue("main");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "main workspace (main branch) - never archived",
      );
      expect(result.content[0].text).toContain("Workspaces to archive: 0");
      expect(result.content[0].text).toContain("Workspaces with changes: 1");
    });

    it("should never archive main workspace (master branch)", async () => {
      const worktrees = [
        {
          worktreePath: "/test/master",
          metadata: {
            ...mockMainWorktreeMetadata,
            worktree: {
              ...mockMainWorktreeMetadata.worktree,
              branch: "master",
            },
            git_info: { base_branch: "master", current_branch: "master" },
          },
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.getDefaultBranch.mockResolvedValue("master");
      mockGitUtils.gitCurrentBranch.mockResolvedValue("master");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "main workspace (master branch) - never archived",
      );
      expect(result.content[0].text).toContain("Workspaces to archive: 0");
    });

    it("should handle branch detection errors conservatively", async () => {
      const worktrees = [
        {
          worktreePath: "/test/unknown",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockRejectedValue(new Error("Git error"));
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      // Should still process the worktree normally when branch detection fails
      expect(result.content[0].text).toContain("Workspaces to archive: 1");
    });
  });

  describe("change detection", () => {
    it("should preserve worktrees with uncommitted changes", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(true);

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("has uncommitted changes");
      expect(result.content[0].text).toContain("Workspaces to archive: 0");
      expect(result.content[0].text).toContain("Workspaces with changes: 1");
    });

    it("should preserve worktrees with committed changes", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 2,
        insertions: 10,
        deletions: 5,
      });

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("has committed changes");
      expect(result.content[0].text).toContain("Workspaces to archive: 0");
      expect(result.content[0].text).toContain("Workspaces with changes: 1");
    });

    it("should archive worktrees with no changes", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "no changes compared to base branch",
      );
      expect(result.content[0].text).toContain("Workspaces to archive: 1");
      expect(result.content[0].text).toContain("Workspaces with changes: 0");
    });

    it("should handle diff stats errors gracefully", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats
        .mockRejectedValueOnce(new Error("Base branch not found"))
        .mockRejectedValueOnce(new Error("Origin branch not found"));

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      // Should assume no changes when diff fails (conservative approach)
      expect(result.content[0].text).toContain(
        "no changes compared to base branch",
      );
      expect(result.content[0].text).toContain("Workspaces to archive: 1");
    });
  });

  describe("metadata handling", () => {
    it("should archive worktrees without metadata", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: null,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("no metadata");
      expect(result.content[0].text).toContain("Workspaces to archive: 1");
    });
  });

  describe("archiving functionality", () => {
    it("should successfully archive clean worktrees", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });
      (
        mockWorktreeManager.archiveWorktreeByPathOrTaskId as any
      ).mockResolvedValue();

      const result = await cleanWorktrees.cb(
        { dry_run: false },
        { worktreeManager: mockWorktreeManager },
      );

      expect(
        mockWorktreeManager.archiveWorktreeByPathOrTaskId,
      ).toHaveBeenCalledWith("/test/path");
      expect(result.content[0].text).toContain("Successfully archived: 1");
      expect(result.content[0].text).not.toContain("Failed to archive:");
    });

    it("should handle archiving errors gracefully", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });
      (
        mockWorktreeManager.archiveWorktreeByPathOrTaskId as any
      ).mockRejectedValue(new Error("Archive failed"));

      const result = await cleanWorktrees.cb(
        { dry_run: false },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("Successfully archived: 0");
      expect(result.content[0].text).toContain("Failed to archive: 1");
      expect(result.content[0].text).toContain("Archive failed");
    });

    it("should handle mixed success and failure scenarios", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path1",
          metadata: mockWorktreeMetadata,
        },
        {
          worktreePath: "/test/path2",
          metadata: {
            ...mockWorktreeMetadata,
            worktree: { ...mockWorktreeMetadata.worktree, id: "task-456" },
          },
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockResolvedValue(false);
      mockGitUtils.gitDiffStats.mockResolvedValue({
        files: 0,
        insertions: 0,
        deletions: 0,
      });

      (mockWorktreeManager.archiveWorktreeByPathOrTaskId as any)
        .mockResolvedValueOnce() // First one succeeds
        .mockRejectedValueOnce(new Error("Archive failed")); // Second one fails

      const result = await cleanWorktrees.cb(
        { dry_run: false },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("Successfully archived: 1");
      expect(result.content[0].text).toContain("Failed to archive: 1");
      expect(result.content[0].text).toContain("Archive failed");
    });
  });

  describe("error handling", () => {
    it("should handle listAllWorktrees errors", async () => {
      mockMetadataManager.listAllWorktrees.mockRejectedValue(
        new Error("Failed to list worktrees"),
      );

      const result = await cleanWorktrees.cb(
        {},
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("Failed to clean workspaces");
      expect(result.content[0].text).toContain("Failed to list worktrees");
    });

    it("should handle individual worktree processing errors", async () => {
      const worktrees = [
        {
          worktreePath: "/test/path",
          metadata: mockWorktreeMetadata,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);
      mockGitUtils.gitCurrentBranch.mockResolvedValue("feature-branch");
      mockGitUtils.gitHasPendingChanges.mockRejectedValue(
        new Error("Git status failed"),
      );

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("Errors: 1");
      expect(result.content[0].text).toContain("Git status failed");
    });
  });

  describe("complex scenarios", () => {
    it("should handle mixed worktree types correctly", async () => {
      const worktrees = [
        // Main workspace - should be preserved
        {
          worktreePath: "/test/main",
          metadata: mockMainWorktreeMetadata,
        },
        // Feature branch with changes - should be preserved
        {
          worktreePath: "/test/feature1",
          metadata: mockWorktreeMetadata,
        },
        // Feature branch without changes - should be archived
        {
          worktreePath: "/test/feature2",
          metadata: {
            ...mockWorktreeMetadata,
            worktree: { ...mockWorktreeMetadata.worktree, id: "task-456" },
          },
        },
        // Worktree without metadata - should be archived
        {
          worktreePath: "/test/no-metadata",
          metadata: null,
        },
      ];

      mockMetadataManager.listAllWorktrees.mockResolvedValue(worktrees);

      mockGitUtils.getDefaultBranch.mockResolvedValue("main");

      // Mock different responses for different worktrees
      mockGitUtils.gitCurrentBranch
        .mockResolvedValueOnce("main") // Main workspace
        .mockResolvedValueOnce("feature-branch") // Feature 1
        .mockResolvedValueOnce("feature-branch-2") // Feature 2
        .mockResolvedValueOnce("feature-branch-3"); // No metadata

      mockGitUtils.gitHasPendingChanges
        .mockResolvedValueOnce(false) // Main workspace
        .mockResolvedValueOnce(true) // Feature 1 has changes
        .mockResolvedValueOnce(false) // Feature 2 no changes
        .mockResolvedValueOnce(false); // No metadata

      mockGitUtils.gitDiffStats
        .mockResolvedValueOnce({ files: 0, insertions: 0, deletions: 0 }) // Main workspace
        .mockResolvedValueOnce({ files: 0, insertions: 0, deletions: 0 }) // Feature 1 (has pending changes, so this won't be called)
        .mockResolvedValueOnce({ files: 0, insertions: 0, deletions: 0 }) // Feature 2 no changes
        .mockResolvedValueOnce({ files: 0, insertions: 0, deletions: 0 }); // No metadata

      const result = await cleanWorktrees.cb(
        { dry_run: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("Total worktrees found: 4");
      expect(result.content[0].text).toContain("Workspaces to archive: 2");
      expect(result.content[0].text).toContain("Workspaces with changes: 2");
      expect(result.content[0].text).toContain(
        "main workspace (main branch) - never archived",
      );
      expect(result.content[0].text).toContain("has uncommitted changes");
      expect(result.content[0].text).toContain(
        "no changes compared to base branch",
      );
      expect(result.content[0].text).toContain("no metadata");
    });
  });
});
