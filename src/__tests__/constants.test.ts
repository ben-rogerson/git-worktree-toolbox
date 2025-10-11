/**
 * Tests for global configuration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getGlobalConfig } from "@/src/utils/constants";
import * as path from "path";
import * as os from "os";

describe("getGlobalConfig", () => {
  const originalEnv = { ...process.env };
  const homeDir = os.homedir();

  beforeEach(() => {
    // Reset environment before each test
    delete process.env.BASE_WORKTREES_PATH;
    delete process.env.PROJECT_DIRECTORIES;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it("should return default baseWorktreesPath when no env var is set", () => {
    const config = getGlobalConfig();

    expect(config.baseWorktreesPath).toBe(
      path.join(homeDir, ".gwtree", "worktrees"),
    );
  });

  it("should return custom baseWorktreesPath from env var", () => {
    const customPath = "/custom/worktrees/path";
    process.env.BASE_WORKTREES_PATH = customPath;

    const config = getGlobalConfig();

    expect(config.baseWorktreesPath).toBe(customPath);
  });

  it("should return undefined projectDirectories when no env var is set", () => {
    const config = getGlobalConfig();

    expect(config.projectDirectories).toBeUndefined();
  });

  it("should parse PROJECT_DIRECTORIES from colon-separated string", () => {
    process.env.PROJECT_DIRECTORIES = "/dir1:/dir2:/dir3";

    const config = getGlobalConfig();

    expect(config.projectDirectories).toEqual(["/dir1", "/dir2", "/dir3"]);
  });

  it("should filter out empty strings from PROJECT_DIRECTORIES", () => {
    process.env.PROJECT_DIRECTORIES = "/dir1::/dir2:::/dir3";

    const config = getGlobalConfig();

    expect(config.projectDirectories).toEqual(["/dir1", "/dir2", "/dir3"]);
  });

  it("should handle single directory in PROJECT_DIRECTORIES", () => {
    process.env.PROJECT_DIRECTORIES = "/single/dir";

    const config = getGlobalConfig();

    expect(config.projectDirectories).toEqual(["/single/dir"]);
  });

  it("should handle empty PROJECT_DIRECTORIES", () => {
    process.env.PROJECT_DIRECTORIES = "";

    const config = getGlobalConfig();

    expect(config.projectDirectories).toEqual([]);
  });

  it("should handle tilde expansion in BASE_WORKTREES_PATH", () => {
    process.env.BASE_WORKTREES_PATH = "~/custom-worktrees";

    const config = getGlobalConfig();

    // Note: The function doesn't expand tilde - that's handled by the shell
    // We just verify it passes through correctly
    expect(config.baseWorktreesPath).toBe("~/custom-worktrees");
  });

  it("should return both custom values when both env vars are set", () => {
    process.env.BASE_WORKTREES_PATH = "/custom/path";
    process.env.PROJECT_DIRECTORIES = "/proj1:/proj2";

    const config = getGlobalConfig();

    expect(config.baseWorktreesPath).toBe("/custom/path");
    expect(config.projectDirectories).toEqual(["/proj1", "/proj2"]);
  });
});
