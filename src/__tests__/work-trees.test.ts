import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecAsync = vi.hoisted(() => vi.fn());

// Mock the dependencies
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

import {
  createWorkTree,
  listWorkTrees,
  removeWorkTree,
} from "../worktree/git-operations";
import type { WorkTree } from "../worktree/types";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("fs");

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-123"),
}));

const mockFs = vi.mocked(fs);

// Test constants
const MOCK_WORK_TREE: WorkTree = {
  id: "test-id-123",
  name: "feature-branch",
  path: "/path/to/worktree",
  branch: "main",
  created: new Date("2024-01-01T00:00:00.000Z"),
};

const TEST_BRANCH_NAMES = {
  VALID: "new-feature",
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
    mockExecAsync.mockReset();

    // Setup default mocks
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(new Error("Path does not exist"));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockRejectedValue(new Error("File not found"));
    mockFs.stat.mockResolvedValue({
      birthtime: new Date("2024-01-01T00:00:00.000Z"),
      mtime: new Date("2024-01-01T00:00:00.000Z"),
    } as never);

    // Reset mockExecAsync to return a default successful response
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
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
        // Mock listWorkTrees to return existing worktree with same name
        // Use a path that will result in the same name when basename is applied
        const worktreePath = `/path/to/${MOCK_WORK_TREE.name}`;
        mockExecAsync.mockResolvedValueOnce({
          stdout: `worktree ${worktreePath}\nbranch refs/heads/${MOCK_WORK_TREE.branch}\n\n`,
          stderr: "",
        }); // listWorkTrees

        await expect(
          createWorkTree(MOCK_WORK_TREE.name, "main"),
        ).rejects.toThrow("already exists");
      });

      it("should validate path permissions", async () => {
        // Mock mkdir to fail (permission denied)
        mockFs.mkdir.mockRejectedValue(new Error("EACCES: permission denied"));

        await expect(createWorkTree("test", "main")).rejects.toThrow(
          "Failed to create directory",
        );
      });

      describe("successful creation", () => {
        it("should create a work tree with name and branch", async () => {
          // Mock successful git worktree operations
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // listWorkTrees returns empty (called first in createWorkTree)
            .mockResolvedValueOnce({ stdout: "commit-hash", stderr: "" }) // gitHasCommits
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitBranchExists returns false
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitCreateBranch
            .mockResolvedValueOnce({ stdout: "success", stderr: "" }); // gitWorktreeAdd succeeds

          const result = await createWorkTree("test-worktree", "test");

          expect(result.name).toBe("test-worktree");
          expect(result.branch).toBe("test");
          expect(result.id).toBe("test-uuid-123");
          expect(result.path).toContain("test-worktree");
        });

        it("should create a work tree with custom path", async () => {
          const customPath = "/custom/path/worktree";

          mockExecAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "commit-hash", stderr: "" }) // gitHasCommits
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitBranchExists
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitCreateBranch
            .mockResolvedValueOnce({ stdout: "success", stderr: "" }); // gitWorktreeAdd

          const result = await createWorkTree("test", "main", customPath);
          expect(result.path).toBe(customPath);
        });

        it("should generate unique ID for work tree", async () => {
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "commit-hash", stderr: "" }) // gitHasCommits
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitBranchExists
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitCreateBranch
            .mockResolvedValueOnce({ stdout: "success", stderr: "" }); // gitWorktreeAdd

          const result = await createWorkTree("test", "main");
          expect(result.id).toBe("test-uuid-123");
          expect(typeof result.id).toBe("string");
          expect(result.id.length).toBeGreaterThan(0);
        });

        it("should set creation timestamp", async () => {
          mockExecAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // listWorkTrees returns empty
            .mockResolvedValueOnce({ stdout: "commit-hash", stderr: "" }) // gitHasCommits
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitBranchExists
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // gitCreateBranch
            .mockResolvedValueOnce({ stdout: "success", stderr: "" }); // gitWorktreeAdd

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
          mockExecAsync.mockRejectedValue(new Error("git command failed"));

          await expect(listWorkTrees()).rejects.toThrow(
            "Failed to list work trees",
          );
        });

        it("should filter out invalid/corrupted work trees", async () => {
          const malformedOutput = `worktree /path/to/valid
branch refs/heads/main

invalid-entry-without-path
malformed data

worktree /path/to/valid2
branch refs/heads/feature

`;
          mockExecAsync.mockResolvedValue({
            stdout: malformedOutput,
            stderr: "",
          });

          const result = await listWorkTrees();

          // Should only return valid worktrees, filtering out corrupted ones
          expect(result).toHaveLength(2);
          expect(result[0].path).toBe("/path/to/valid");
          expect(result[1].path).toBe("/path/to/valid2");
        });
      });

      describe("data retrieval", () => {
        it("should return empty array when no work trees exist", async () => {
          mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

          const result = await listWorkTrees();
          expect(result).toEqual([]);
        });

        it("should return all work trees with proper structure", async () => {
          mockExecAsync.mockResolvedValue({
            stdout: MOCK_WORKTREE_LIST_OUTPUT,
            stderr: "",
          });

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
          mockExecAsync.mockResolvedValue({
            stdout: MOCK_WORKTREE_LIST_OUTPUT,
            stderr: "",
          });

          const result = await listWorkTrees();

          // Should include the main worktree (first one in our mock output)
          const mainWorkTree = result.find((wt) => wt.path === "/path/to/main");
          expect(mainWorkTree).toBeDefined();
          expect(mainWorkTree?.branch).toBe("main");
        });

        it("should sort work trees by creation date", async () => {
          mockExecAsync.mockResolvedValue({
            stdout: MOCK_WORKTREE_LIST_OUTPUT,
            stderr: "",
          });

          // Mock different stat times for different paths
          mockFs.stat.mockImplementation((statPath) => {
            if (statPath === "/path/to/main") {
              return Promise.resolve({
                birthtime: new Date("2024-01-01T00:00:00.000Z"),
                mtime: new Date("2024-01-01T00:00:00.000Z"),
              } as never);
            } else {
              return Promise.resolve({
                birthtime: new Date("2024-01-02T00:00:00.000Z"),
                mtime: new Date("2024-01-02T00:00:00.000Z"),
              } as never);
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
        it("should return a promise (implementation complete)", async () => {
          const result = removeWorkTree("test");
          expect(result).toBeInstanceOf(Promise);
          // Await the promise to prevent unhandled rejection
          try {
            await result;
          } catch {
            // Expected to fail since "test" worktree doesn't exist
          }
        });

        it("should handle non-existent work tree names", async () => {
          // Mock listWorkTrees to return empty list (no worktrees found)
          mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

          await expect(removeWorkTree("non-existent")).rejects.toThrow(
            "not found",
          );
        });

        it("should prevent removal of main work tree", async () => {
          vi.spyOn(process, "cwd").mockReturnValue("/path/to/main");

          mockExecAsync.mockResolvedValue({
            stdout: `worktree ${process.cwd()}\nbranch refs/heads/main\n\n`,
            stderr: "",
          });

          await expect(removeWorkTree("main")).rejects.toThrow(
            "Cannot remove main work tree",
          );
        });

        it("should handle git command failures", async () => {
          mockExecAsync
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            .mockRejectedValueOnce(new Error("git worktree remove failed"));

          await expect(removeWorkTree("test-branch")).rejects.toThrow(
            "Failed to remove work tree",
          );
        });
      });

      describe("successful removal", () => {
        it("should remove work tree by name", async () => {
          mockExecAsync
            // listWorkTrees call (first call in removeWorkTree)
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            // git worktree prune (first call)
            .mockResolvedValueOnce({ stdout: "", stderr: "" })
            // git worktree list --porcelain (for validation)
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            // git worktree remove
            .mockResolvedValueOnce({ stdout: "success", stderr: "" })
            // git worktree prune (after removal)
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

          await expect(removeWorkTree("test-branch")).resolves.toBeUndefined();
        });

        it("should clean up work tree directory", async () => {
          mockExecAsync
            // listWorkTrees call (first call in removeWorkTree)
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            // git worktree prune (first call)
            .mockResolvedValueOnce({ stdout: "", stderr: "" })
            // git worktree list --porcelain (for validation)
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            // git worktree remove
            .mockResolvedValueOnce({ stdout: "success", stderr: "" })
            // git worktree prune (after removal)
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

          mockFs.access.mockResolvedValue(undefined);
          mockFs.rm.mockResolvedValue(undefined);

          await removeWorkTree("test-branch");

          expect(mockFs.rm).toHaveBeenCalled();
        });

        it("should force remove if directory is locked", async () => {
          const worktreePath = "/path/to/test-branch";
          mockExecAsync
            // listWorkTrees call (first call in removeWorkTree)
            .mockResolvedValueOnce({
              stdout: `worktree ${worktreePath}\nbranch refs/heads/test\n\n`,
              stderr: "",
            })
            // git worktree prune (first call)
            .mockResolvedValueOnce({ stdout: "", stderr: "" })
            // git worktree list --porcelain (for validation)
            .mockResolvedValueOnce({
              stdout: `worktree ${worktreePath}\nbranch refs/heads/test\n\n`,
              stderr: "",
            })
            // git worktree remove (fails with locked error)
            .mockRejectedValueOnce(new Error("worktree locked"))
            // git worktree prune (before force removal)
            .mockResolvedValueOnce({ stdout: "", stderr: "" })
            // git worktree list --porcelain (for force validation)
            .mockResolvedValueOnce({
              stdout: `worktree ${worktreePath}\nbranch refs/heads/test\n\n`,
              stderr: "",
            })
            // git worktree remove --force (succeeds)
            .mockResolvedValueOnce({
              stdout: "force removal success",
              stderr: "",
            })
            // git worktree prune (after removal)
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

          await expect(
            removeWorkTree("test-branch", true),
          ).resolves.toBeUndefined();

          expect(mockExecAsync).toHaveBeenCalledTimes(8);
        });

        it("should update work tree registry after removal", async () => {
          mockExecAsync
            // listWorkTrees call (first call in removeWorkTree)
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            // git worktree prune (first call)
            .mockResolvedValueOnce({ stdout: "", stderr: "" })
            // git worktree list --porcelain (for validation)
            .mockResolvedValueOnce({
              stdout:
                "worktree /path/to/test-branch\nbranch refs/heads/test\n\n",
              stderr: "",
            })
            // git worktree remove
            .mockResolvedValueOnce({ stdout: "success", stderr: "" })
            // git worktree prune (after removal)
            .mockResolvedValueOnce({ stdout: "", stderr: "" });

          await removeWorkTree("test-branch");

          expect(mockExecAsync).toHaveBeenCalledWith(
            expect.stringContaining("git worktree remove"),
            expect.any(Object),
          );
        });
      });
    });
  });
});
