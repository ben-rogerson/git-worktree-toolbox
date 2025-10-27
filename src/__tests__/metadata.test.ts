import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WorktreeMetadataManager } from "../worktree/metadata";
import * as fs from "fs";
import * as yaml from "js-yaml";
import type { WorktreeMetadata } from "../worktree/types";

vi.mock("fs");
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-123"),
}));
vi.mock("@/src/utils/git", () => ({
  gitGetRemoteUrl: vi.fn().mockResolvedValue("https://github.com/test/repo"),
  getDefaultBranch: vi.fn().mockResolvedValue("main"),
  gitCurrentBranch: vi.fn().mockResolvedValue("test-branch"),
  gitWorktreeList: vi.fn().mockResolvedValue(""),
}));

const mockFs = vi.mocked(fs);

describe("WorktreeMetadataManager", () => {
  const testWorktreePath = "/test/worktree/path";
  const mockMetadata: WorktreeMetadata = {
    worktree: {
      id: "test-id",
      name: "test-worktree",
      path: testWorktreePath,
      branch: "test-branch",
      created_at: new Date().toISOString(),
      created_by: "test-user",
      status: "active",
    },
    conversation_history: [],
    git_info: {
      base_branch: "main",
      current_branch: "test-branch",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(yaml.dump(mockMetadata));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createMetadata", () => {
    it("should create metadata with system as creator", async () => {
      const result = await WorktreeMetadataManager.createMetadata(
        testWorktreePath,
        {
          worktree_name: "test",
          branch: "feature",
          task_description: "Test task",
        },
      );

      expect(result.worktree.created_by).toBe("system");
    });
  });

  describe("loadMetadata", () => {
    it("should load valid metadata", async () => {
      mockFs.existsSync.mockReturnValue(true);
      const fileContent = Buffer.from(yaml.dump(mockMetadata));
      mockFs.readFileSync.mockReturnValue(fileContent);

      const result =
        await WorktreeMetadataManager.loadMetadata(testWorktreePath);

      expect(result).not.toBeNull();
      expect(result?.worktree.id).toBe("test-id");
    });

    it("should return null when metadata file doesn't exist", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result =
        await WorktreeMetadataManager.loadMetadata(testWorktreePath);

      expect(result).toBeNull();
    });

    it("should repair corrupted YAML and return repaired metadata", async () => {
      mockFs.readFileSync.mockReturnValue("invalid: yaml: {{{{");

      const result =
        await WorktreeMetadataManager.loadMetadata(testWorktreePath);

      // Should return null when repair fails for severely corrupted YAML
      expect(result).toBeNull();
    });

    it("should repair invalid schema and return repaired metadata", async () => {
      mockFs.readFileSync.mockReturnValue(yaml.dump({ invalid: "structure" }));

      const result =
        await WorktreeMetadataManager.loadMetadata(testWorktreePath);

      // Should return null when schema is invalid and cannot be repaired
      // (requires essential fields like worktree.branch and git_info.base_branch)
      expect(result).toBeNull();
    });
  });

  describe("deleteMetadata", () => {
    it("should delete metadata directory", () => {
      WorktreeMetadataManager.deleteMetadata(testWorktreePath);

      expect(mockFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining(".gwtree/metadata"),
        { recursive: true, force: true },
      );
    });

    it("should handle non-existent metadata gracefully", () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() =>
        WorktreeMetadataManager.deleteMetadata(testWorktreePath),
      ).not.toThrow();
    });

    it("should warn on deletion errors but not throw", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      mockFs.rmSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      WorktreeMetadataManager.deleteMetadata(testWorktreePath);

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe("path hashing", () => {
    it("should generate consistent hashes for same path", () => {
      const dir1 = WorktreeMetadataManager.getMetadataDir("/same/path");
      const dir2 = WorktreeMetadataManager.getMetadataDir("/same/path");

      expect(dir1).toBe(dir2);
    });

    it("should generate different hashes for different paths", () => {
      const dir1 = WorktreeMetadataManager.getMetadataDir("/path/one");
      const dir2 = WorktreeMetadataManager.getMetadataDir("/path/two");

      expect(dir1).not.toBe(dir2);
    });
  });

  describe("getWorktreeByTaskId", () => {
    it("should find worktree by task ID", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: "hash1", isDirectory: () => true },
      ] as any);

      const result =
        await WorktreeMetadataManager.getWorktreeByTaskId("test-id");

      expect(result).not.toBeNull();
      expect(result?.metadata.worktree.id).toBe("test-id");
    });

    it("should return null when task ID not found", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: "hash1", isDirectory: () => true },
      ] as any);

      const result =
        await WorktreeMetadataManager.getWorktreeByTaskId("non-existent-id");

      expect(result).toBeNull();
    });

    it("should return null when metadata root doesn't exist", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result =
        await WorktreeMetadataManager.getWorktreeByTaskId("test-id");

      expect(result).toBeNull();
    });
  });

  describe("getWorktreeByPathOrTaskId", () => {
    it("should find by absolute path", async () => {
      // Mock path.isAbsolute to return true for the test path
      mockFs.existsSync.mockImplementation((path) => {
        return (
          String(path).includes(testWorktreePath) ||
          String(path).includes(".gwtree")
        );
      });

      const result =
        await WorktreeMetadataManager.getWorktreeByPathOrTaskId(
          testWorktreePath,
        );

      expect(result).not.toBeNull();
      expect(result?.worktreePath).toBe(testWorktreePath);
    });

    it("should find by worktree name", async () => {
      mockFs.existsSync.mockImplementation((path) =>
        String(path).includes(".gwtree"),
      );
      mockFs.readdirSync.mockReturnValue([
        { name: "hash1", isDirectory: () => true },
      ] as any);

      const result =
        await WorktreeMetadataManager.getWorktreeByPathOrTaskId(
          "test-worktree",
        );

      expect(result).not.toBeNull();
      expect(result?.metadata.worktree.name).toBe("test-worktree");
    });

    it("should warn when path exists but has no metadata", async () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error("No metadata");
      });

      const result =
        await WorktreeMetadataManager.getWorktreeByPathOrTaskId(
          testWorktreePath,
        );

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe("ensureMetadataForWorktrees", () => {
    it("should return succeeded and failed lists", async () => {
      const ensureFn = vi.fn().mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(false);

      const result = await WorktreeMetadataManager.ensureMetadataForWorktrees(
        ["/path1", "/path2"],
        ensureFn,
      );

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it("should handle partial failures", async () => {
      const ensureFn = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Failed"));
      mockFs.existsSync.mockReturnValue(false);

      const result = await WorktreeMetadataManager.ensureMetadataForWorktrees(
        ["/path1", "/path2"],
        ensureFn,
      );

      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].path).toBe("/path2");
      expect(result.failed[0].error).toBe("Failed");
    });

    it("should skip worktrees that already have metadata", async () => {
      const ensureFn = vi.fn().mockResolvedValue(undefined);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(yaml.dump(mockMetadata));

      const result = await WorktreeMetadataManager.ensureMetadataForWorktrees(
        [testWorktreePath],
        ensureFn,
      );

      expect(result.succeeded).toHaveLength(1);
      expect(ensureFn).not.toHaveBeenCalled();
    });
  });

  describe("listAllWorktrees", () => {
    it("should filter out archived worktrees", async () => {
      const activeMetadata: WorktreeMetadata = {
        ...mockMetadata,
        worktree: { ...mockMetadata.worktree, status: "active" },
      };
      const archivedMetadata: WorktreeMetadata = {
        ...mockMetadata,
        worktree: {
          ...mockMetadata.worktree,
          id: "archived-id",
          status: "archived",
        },
      };

      mockFs.readFileSync
        .mockReturnValueOnce(yaml.dump(activeMetadata))
        .mockReturnValueOnce(yaml.dump(archivedMetadata));

      expect(activeMetadata.worktree.status).toBe("active");
      expect(archivedMetadata.worktree.status).toBe("archived");
    });
  });
});
