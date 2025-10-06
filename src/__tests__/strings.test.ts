import { describe, it, expect } from "vitest";
import {
  sanitizeForGit,
  extractKeywords,
  generateWorktreeName,
  generateBranchName,
} from "../utils/strings";

describe("String Utilities", () => {
  describe("sanitizeForGit", () => {
    it("should convert to lowercase", () => {
      expect(sanitizeForGit("UPPERCASE")).toBe("uppercase");
    });

    it("should remove special characters", () => {
      expect(sanitizeForGit("test@#$%")).toBe("test");
      expect(sanitizeForGit("hello!world?")).toBe("helloworld");
    });

    it("should preserve alphanumeric and spaces", () => {
      expect(sanitizeForGit("test 123")).toBe("test 123");
    });

    it("should trim whitespace", () => {
      expect(sanitizeForGit("  test  ")).toBe("test");
    });

    it("should handle empty strings", () => {
      expect(sanitizeForGit("")).toBe("");
    });

    it("should handle strings with only special chars", () => {
      expect(sanitizeForGit("@#$%^&*")).toBe("");
    });
  });

  describe("extractKeywords", () => {
    it("should extract up to maxWords", () => {
      const result = extractKeywords("one two three four five", {
        maxWords: 3,
      });
      expect(result).toHaveLength(3);
    });

    it("should filter out excluded words", () => {
      const result = extractKeywords("help with the task", {
        excludeWords: ["help", "with", "the", "task"],
      });
      expect(result).toHaveLength(0);
    });

    it("should filter out short words", () => {
      const result = extractKeywords("a big word is here", {
        minWordLength: 3,
      });
      expect(result).not.toContain("a");
      expect(result).not.toContain("is");
    });

    it("should handle empty input", () => {
      const result = extractKeywords("");
      expect(result).toHaveLength(0);
    });

    it("should use default exclusions", () => {
      const result = extractKeywords("help with the feature");
      expect(result).not.toContain("help");
      expect(result).not.toContain("with");
      expect(result).not.toContain("the");
    });
  });

  describe("generateWorktreeName", () => {
    it("should include extracted keywords", () => {
      const name = generateWorktreeName("fix authentication bug", "user123");
      expect(name).toContain("fix");
      expect(name).toContain("authentication");
    });

    it("should include user identifier", () => {
      const name = generateWorktreeName("test task", "john.doe");
      expect(name).toContain("john");
    });

    it("should handle user ID without dots", () => {
      const name = generateWorktreeName("test", "shortid");
      expect(name).toContain("shortid");
    });

    it("should truncate long user IDs", () => {
      const name = generateWorktreeName(
        "test",
        "verylonguseridthatexceedslimit",
      );
      expect(name).toContain("verylonguseridthatexceedslimit");
    });

    it("should use 'anon' when no user ID provided", () => {
      const name = generateWorktreeName("test task");
      expect(name).toContain("anon");
    });

    it("should include timestamp suffix", () => {
      const name = generateWorktreeName("test", "user");
      expect(name).toMatch(/\d{4}$/);
    });

    it("should handle empty description", () => {
      const name = generateWorktreeName("", "user");
      expect(name).toContain("task");
      expect(name).toContain("user");
    });

    it("should handle description with only special chars", () => {
      const name = generateWorktreeName("@#$%^&", "user");
      expect(name).toContain("task");
    });

    it("should handle very long descriptions", () => {
      const longDesc =
        "implement a new feature with authentication and authorization for the user management system";
      const name = generateWorktreeName(longDesc, "user");
      expect(name.length).toBeLessThan(100);
    });
  });

  describe("generateBranchName", () => {
    it("should extract keywords from description", () => {
      const branch = generateBranchName("fix authentication bug");
      expect(branch).toContain("fix");
      expect(branch).toContain("authentication");
    });

    it("should use up to 4 keywords", () => {
      const branch = generateBranchName("one two three four five six");
      const parts = branch.split("-");
      const keywords = parts.slice(0, -1);
      expect(keywords.length).toBeLessThanOrEqual(4);
    });

    it("should include timestamp suffix", () => {
      const branch = generateBranchName("test");
      expect(branch).toMatch(/\d{4}$/);
    });

    it("should handle empty description", () => {
      const branch = generateBranchName("");
      expect(branch).toContain("task");
    });

    it("should produce valid git branch name", () => {
      const branch = generateBranchName("Test Feature #123!");
      expect(branch).not.toContain("#");
      expect(branch).not.toContain("!");
      expect(branch).not.toContain(" ");
      expect(branch).toMatch(/^[a-z0-9-]+$/);
    });

    it("should handle description with only excluded words", () => {
      const branch = generateBranchName("the and for with");
      expect(branch).toContain("task");
    });
  });
});
