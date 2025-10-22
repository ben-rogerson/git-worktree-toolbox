/**
 * Tests for file system utilities
 */

import { describe, it, expect, afterEach } from "vitest";
import { ensureWorktreesReadme } from "@/src/utils/fs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ensureWorktreesReadme", () => {
  const testDir = path.join(os.tmpdir(), "gwtree-test-readme");
  const readmePath = path.join(testDir, "README.md");

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should create README.md in worktrees directory", () => {
    ensureWorktreesReadme(testDir);

    expect(fs.existsSync(readmePath)).toBe(true);
  });

  it("should create directory if it does not exist", () => {
    ensureWorktreesReadme(testDir);

    expect(fs.existsSync(testDir)).toBe(true);
    expect(fs.existsSync(readmePath)).toBe(true);
  });

  it("should not overwrite existing README.md", () => {
    fs.mkdirSync(testDir, { recursive: true });
    const customContent = "# Custom README\n\nMy custom content";
    fs.writeFileSync(readmePath, customContent, "utf8");

    ensureWorktreesReadme(testDir);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toBe(customContent);
  });

  it("should include project link in README", () => {
    ensureWorktreesReadme(testDir);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("git-worktree-toolbox");
    expect(content).toContain(
      "https://github.com/ben-rogerson/git-worktree-toolbox",
    );
  });

  it("should include usage examples in README", () => {
    ensureWorktreesReadme(testDir);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("gwtree create");
    expect(content).toContain("gwtree list");
    expect(content).toContain("gwtree remove");
  });

  it("should include directory structure example", () => {
    ensureWorktreesReadme(testDir);

    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain("~/.gwtree/");
    expect(content).toContain("my-project");
  });
});
