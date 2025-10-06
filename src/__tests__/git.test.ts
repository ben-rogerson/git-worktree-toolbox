import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecAsync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

import {
  executeGitCommand,
  gitWorktreeList,
  gitCheckoutFiles,
  gitHasPendingChanges,
} from "../utils/git";

describe("Git Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockReset();
  });

  describe("executeGitCommand", () => {
    it("should execute command successfully", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "success", stderr: "" });

      const result = await executeGitCommand("git status");

      expect(result.stdout).toBe("success");
    });

    it("should throw error with command context on failure", async () => {
      mockExecAsync.mockRejectedValue({
        message: "Command failed",
        stdout: "out",
        stderr: "err",
      });

      try {
        await executeGitCommand("git invalid");
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const gitError = error as { code: string; command: string };
        expect(gitError.code).toBe("GIT_ERROR");
        expect(gitError.command).toBe("git invalid");
      }
    });

    it("should handle timeout errors", async () => {
      mockExecAsync.mockRejectedValue({
        message: "Timeout",
        killed: true,
        signal: "SIGTERM",
      });

      try {
        await executeGitCommand("git long-running", { timeout: 1000 });
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const gitError = error as { code: string };
        expect(gitError.code).toBe("GIT_TIMEOUT");
      }
    });

    it("should use custom cwd when provided", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await executeGitCommand("git status", { cwd: "/custom/path" });

      expect(mockExecAsync).toHaveBeenCalledWith("git status", {
        cwd: "/custom/path",
        timeout: 30000,
        encoding: "utf8",
      });
    });
  });

  describe("gitCheckoutFiles", () => {
    it("should checkout files excluding ignored paths", async () => {
      mockExecAsync
        .mockResolvedValueOnce({
          stdout: "file1.ts\n.claude/config.yaml\nfile2.ts\n",
          stderr: "",
        })
        .mockResolvedValueOnce({ stdout: "", stderr: "" });

      await gitCheckoutFiles("main");

      const checkoutCall = mockExecAsync.mock.calls[1][0] as string;
      expect(checkoutCall).toContain("file1.ts");
      expect(checkoutCall).toContain("file2.ts");
      expect(checkoutCall).not.toContain(".claude");
    });

    it("should not checkout when all files are ignored", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: ".claude/config.yaml\n.claude-backup/file.txt\n",
        stderr: "",
      });

      await gitCheckoutFiles("main");

      expect(mockExecAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("gitHasPendingChanges", () => {
    it("should return true for pending changes", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "M  file1.ts\nA  file2.ts\n",
        stderr: "",
      });

      const result = await gitHasPendingChanges();

      expect(result).toBe(true);
    });

    it("should return false when no changes", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await gitHasPendingChanges();

      expect(result).toBe(false);
    });

    it("should filter out Claude directory changes", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "M  .claude/config.yaml\n",
        stderr: "",
      });

      const result = await gitHasPendingChanges();

      expect(result).toBe(false);
    });

    it("should filter out gitignore changes", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "M  .gitignore\n",
        stderr: "",
      });

      const result = await gitHasPendingChanges();

      expect(result).toBe(false);
    });

    it("should return true for significant changes alongside ignored files", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "M  src/important.ts\nM  .claude/config.yaml\nM  .gitignore\n",
        stderr: "",
      });

      const result = await gitHasPendingChanges();

      expect(result).toBe(true);
    });
  });

  describe("gitWorktreeList", () => {
    it("should return porcelain format output", async () => {
      const output = "worktree /path\nbranch refs/heads/main\n";
      mockExecAsync.mockResolvedValue({ stdout: output, stderr: "" });

      const result = await gitWorktreeList();

      expect(result).toBe(output);
      expect(mockExecAsync).toHaveBeenCalledWith(
        "git worktree list --porcelain",
        expect.any(Object),
      );
    });
  });
});
