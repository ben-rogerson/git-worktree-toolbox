import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createWorkTree,
  listWorkTrees,
  removeWorkTree,
} from "../workspace/git-operations";
import type { WorkTree } from "../workspace/types";
import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

// Mock the dependencies
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));
vi.mock("fs/promises");
vi.mock("fs");
vi.mock("util", () => ({
  promisify: vi.fn(),
}));
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-123"),
}));

vi.mocked(exec);
const mockFs = vi.mocked(fs);
const mockPromisify = vi.mocked(promisify);

// Test constants
const MOCK_WORK_TREE: WorkTree = {
  id: "test-id-123",
  name: "feature-branch",
  path: "/path/to/worktree",
  branch: "main",
  created: new Date("2024-01-01T00:00:00.000Z"),
};

const TEST_BRANCH_NAMES = {
  VALID: "feature/new-feature",
  INVALID: "invalid..branch",
  EXISTING: "existing-branch",
};

// Mock git worktree list output
const MOCK_WORKTREE_LIST_OUTPUT = `worktree /path/to/main
branch refs/heads/main

worktree /path/to/feature-branch
branch refs/heads/feature-branch

`;

describe("Work Trees", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(new Error("Path does not exist"));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue(new Error("File not found"));
    mockFs.stat.mockResolvedValue({
      birthtime: new Date("2024-01-01T00:00:00.000Z"),
      mtime: new Date("2024-01-01T00:00:00.000Z"),
    } as any);
  });

  describe("createWorkTree", () => {
    describe("error handling", () => {
      it("should return a promise (implementation complete)", () => {
        const result = createWorkTree("test", "main");
        expect(result).toBeInstanceOf(Promise);
      });

      it("should handle invalid branch names", async () => {
        await expect(
          createWorkTree("test", TEST_BRANCH_NAMES.INVALID),
        ).rejects.toThrow("Invalid branch name");

        await expect(createWorkTree("test", "")).rejects.toThrow(
          "Invalid branch name",
        );

        await expect(
          createWorkTree("test", "branch with spaces"),
        ).rejects.toThrow("Invalid branch name");

        await expect(createWorkTree("test", "-invalid-start")).rejects.toThrow(
          "Invalid branch name",
        );
      });

      it("should handle existing work tree names", async () => {
        // Mock successful exec for listWorkTrees
        const mockExecAsync = vi.fn().mockResolvedValue({
          stdout: `worktree ${MOCK_WORK_TREE.path}\nbranch refs/heads/${MOCK_WORK_TREE.branch}\n\n`,
        });
        mockPromisify.mockReturnValue(mockExecAsync);

        await expect(
          createWorkTree(MOCK_WORK_TREE.name, "main"),
        ).rejects.toThrow("already exists");
      });

      it("should validate path permissions", async () => {
        // Mock mkdir to fail (permission denied)
        mockFs.mkdir.mockRejectedValue(new Error("EACCES: permission denied"));

        await expect(createWorkTree("test", "main")).rejects.toThrow(
          "Permission denied",
        );
      });

      describe("successful creation", () => {
        it("should create a work tree with name and branch", async () => {
          // Mock successful git worktree operations
          const mockExecAsync = vi.fn();
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "success" }); // createWorktree succeeds

          mockPromisify.mockReturnValue(mockExecAsync);

          const result = await createWorkTree("test-worktree", "feature/test");

          expect(result.name).toBe("test-worktree");
          expect(result.branch).toBe("feature/test");
          expect(result.id).toBe("test-uuid-123");
          expect(result.path).toContain("test-worktree");
        });

        it("should create a work tree with custom path", async () => {
          const customPath = "/custom/path/worktree";

          // Mock successful operations
          const mockExecAsync = vi.fn();
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "success" }); // createWorktree succeeds

          mockPromisify.mockReturnValue(mockExecAsync);

          const result = await createWorkTree("test", "main", customPath);
          expect(result.path).toBe(customPath);
        });

        it("should generate unique ID for work tree", async () => {
          // Mock successful operations
          const mockExecAsync = vi.fn();
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "success" }); // createWorktree succeeds

          mockPromisify.mockReturnValue(mockExecAsync);

          const result = await createWorkTree("test", "main");
          expect(result.id).toBe("test-uuid-123");
          expect(typeof result.id).toBe("string");
          expect(result.id.length).toBeGreaterThan(0);
        });

        it("should set creation timestamp", async () => {
          // Mock successful operations
          const mockExecAsync = vi.fn();
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "success" }); // createWorktree succeeds

          mockPromisify.mockReturnValue(mockExecAsync);

          const before = new Date();
          const result = await createWorkTree("test", "main");
          const after = new Date();

          expect(result.created).toBeInstanceOf(Date);
          expect(result.created.getTime()).toBeGreaterThanOrEqual(
            before.getTime(),
          );
          expect(result.created.getTime()).toBeLessThanOrEqual(after.getTime());
        });
      });
    });

    describe("listWorkTrees", () => {
      describe("error handling", () => {
        it("should return a promise (implementation complete)", () => {
          const result = listWorkTrees();
          expect(result).toBeInstanceOf(Promise);
        });

        it("should handle git command failures", async () => {
          // Mock promisify to return a function that rejects
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockRejectedValue(new Error("git command failed")),
          );

          await expect(listWorkTrees()).rejects.toThrow(
            "Failed to list work trees",
          );
        });

        it("should filter out invalid/corrupted work trees", async () => {
          // Mock git output with malformed entries
          const malformedOutput = `worktree /path/to/valid
branch refs/heads/main

invalid-entry-without-path
malformed data

worktree /path/to/valid2
branch refs/heads/feature

`;
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({ stdout: malformedOutput }),
          );

          const result = await listWorkTrees();

          // Should only return valid worktrees, filtering out corrupted ones
          expect(result).toHaveLength(2);
          expect(result[0].path).toBe("/path/to/valid");
          expect(result[1].path).toBe("/path/to/valid2");
        });
      });

      describe("data retrieval", () => {
        it("should return empty array when no work trees exist", async () => {
          // Mock empty git output
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({ stdout: "" }),
          );

          const result = await listWorkTrees();
          expect(result).toEqual([]);
        });

        it("should return all work trees with proper structure", async () => {
          // Mock git worktree list output
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({ stdout: MOCK_WORKTREE_LIST_OUTPUT }),
          );

          const result = await listWorkTrees();

          expect(result).toHaveLength(2);

          // Check structure of returned worktrees
          result.forEach((wt) => {
            expect(wt).toHaveProperty("id");
            expect(wt).toHaveProperty("name");
            expect(wt).toHaveProperty("path");
            expect(wt).toHaveProperty("branch");
            expect(wt).toHaveProperty("created");
            expect(typeof wt.id).toBe("string");
            expect(typeof wt.name).toBe("string");
            expect(typeof wt.path).toBe("string");
            expect(typeof wt.branch).toBe("string");
            expect(wt.created).toBeInstanceOf(Date);
          });
        });

        it("should include main working directory", async () => {
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({ stdout: MOCK_WORKTREE_LIST_OUTPUT }),
          );

          const result = await listWorkTrees();

          // Should include the main worktree (first one in our mock output)
          const mainWorkTree = result.find((wt) => wt.path === "/path/to/main");
          expect(mainWorkTree).toBeDefined();
          expect(mainWorkTree?.branch).toBe("main");
        });

        it("should sort work trees by creation date", async () => {
          // Mock multiple worktrees with different creation times
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({ stdout: MOCK_WORKTREE_LIST_OUTPUT }),
          );

          // Mock different stat times for different paths
          mockFs.stat.mockImplementation((path) => {
            if (path === "/path/to/main") {
              return Promise.resolve({
                birthtime: new Date("2024-01-01T00:00:00.000Z"),
                mtime: new Date("2024-01-01T00:00:00.000Z"),
              } as any);
            } else {
              return Promise.resolve({
                birthtime: new Date("2024-01-02T00:00:00.000Z"),
                mtime: new Date("2024-01-02T00:00:00.000Z"),
              } as any);
            }
          });

          const result = await listWorkTrees();

          // Check that results are sorted by creation date (oldest first)
          for (let i = 1; i < result.length; i++) {
            expect(result[i].created.getTime()).toBeGreaterThanOrEqual(
              result[i - 1].created.getTime(),
            );
          }
        });
      });
    });

    describe("removeWorkTree", () => {
      describe("error handling", () => {
        it("should return a promise (implementation complete)", () => {
          const result = removeWorkTree("test");
          expect(result).toBeInstanceOf(Promise);
        });

        it("should handle non-existent work tree names", async () => {
          // Mock listWorkTrees to return empty array
          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({ stdout: "" }),
          );

          await expect(removeWorkTree("non-existent")).rejects.toThrow(
            "not found",
          );
        });

        it("should prevent removal of main work tree", async () => {
          // Mock listWorkTrees to return main worktree

          // Mock the current working directory check
          vi.spyOn(process, "cwd").mockReturnValue("/path/to/main");

          const { promisify } = await import("util");
          vi.mocked(promisify).mockReturnValue(
            vi.fn().mockResolvedValue({
              stdout: `worktree ${process.cwd()}\nbranch refs/heads/main\n\n`,
            }),
          );

          await expect(removeWorkTree("main")).rejects.toThrow(
            "Cannot remove main work tree",
          );
        });

        it("should handle git command failures", async () => {
          // Mock listWorkTrees to return a valid worktree

          const { promisify } = await import("util");
          const mockExecAsync = vi.fn();

          // First call (listWorkTrees) succeeds, second call (remove) fails
          mockExecAsync
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
            })
            .mockRejectedValueOnce(new Error("git worktree remove failed"));

          vi.mocked(promisify).mockReturnValue(mockExecAsync);

          await expect(removeWorkTree("test-branch")).rejects.toThrow(
            "Failed to remove work tree",
          );
        });
      });

      describe("successful removal", () => {
        it("should remove work tree by name", async () => {
          // Mock listWorkTrees and successful removal
          const { promisify } = await import("util");
          const mockExecAsync = vi.fn();

          mockExecAsync
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
            })
            .mockResolvedValueOnce({ stdout: "success" });

          vi.mocked(promisify).mockReturnValue(mockExecAsync);

          // Should not throw
          await expect(removeWorkTree("test-branch")).resolves.toBeUndefined();
        });

        it("should clean up work tree directory", async () => {
          // Mock successful removal and metadata cleanup
          const { promisify } = await import("util");
          const mockExecAsync = vi.fn();

          mockExecAsync
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
            })
            .mockResolvedValueOnce({ stdout: "success" });

          vi.mocked(promisify).mockReturnValue(mockExecAsync);

          // Mock fs operations for metadata cleanup
          mockFs.access.mockResolvedValue(undefined); // metadata dir exists
          mockFs.rm.mockResolvedValue(undefined); // cleanup succeeds

          await removeWorkTree("test-branch");

          // Verify that metadata cleanup was attempted
          expect(mockFs.rm).toHaveBeenCalled();
        });

        it("should force remove if directory is locked", async () => {
          // Mock listWorkTrees and locked directory scenario
          const { promisify } = await import("util");
          const mockExecAsync = vi.fn();

          mockExecAsync
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
            })
            .mockRejectedValueOnce(new Error("worktree locked")) // normal removal fails
            .mockResolvedValueOnce({ stdout: "force removal success" }); // force removal succeeds

          vi.mocked(promisify).mockReturnValue(mockExecAsync);

          // Should succeed after force removal
          await expect(
            removeWorkTree("test-branch", true),
          ).resolves.toBeUndefined();

          // Verify force removal was attempted
          expect(mockExecAsync).toHaveBeenCalledTimes(3); // list + normal remove + force remove
        });

        it("should update work tree registry after removal", async () => {
          // Mock successful removal
          const { promisify } = await import("util");
          const mockExecAsync = vi.fn();

          mockExecAsync
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
            })
            .mockResolvedValueOnce({ stdout: "success" });

          vi.mocked(promisify).mockReturnValue(mockExecAsync);

          await removeWorkTree("test-branch");

          // Verify git worktree remove command was called
          expect(mockExecAsync).toHaveBeenCalledWith(
            expect.stringContaining("git worktree remove"),
          );
        });
      });
    });
  });
});
