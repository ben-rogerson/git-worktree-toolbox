import { describe, it, expect } from "vitest";
import { parseArgs, buildToolAliases } from "../cli-parser";
import { tools } from "../tools/index";
import type { McpTool } from "../tools/types";

describe("CLI Parser", () => {
  describe("parseArgs", () => {
    it("should return server mode when no args", async () => {
      const result = await parseArgs([], tools);
      expect(result.mode).toBe("server");
    });

    it("should return version mode for --version", async () => {
      const result = await parseArgs(["--version"], tools);
      expect(result.mode).toBe("version");
    });

    it("should return version mode for -v", async () => {
      const result = await parseArgs(["-v"], tools);
      expect(result.mode).toBe("version");
    });

    it("should return help mode for --help", async () => {
      const result = await parseArgs(["--help"], tools);
      expect(result.mode).toBe("help");
    });

    it("should return help mode for -h", async () => {
      const result = await parseArgs(["-h"], tools);
      expect(result.mode).toBe("help");
    });

    it("should return help mode for help", async () => {
      const result = await parseArgs(["help"], tools);
      expect(result.mode).toBe("help");
    });

    it("should resolve tool by name", async () => {
      const result = await parseArgs(["create"], tools);
      expect(result.mode).toBe("tool");
      expect(result.toolName).toBe("create");
    });

    it("should resolve tool by alias", async () => {
      const result = await parseArgs(["new"], tools);
      expect(result.toolName).toBe("create");
    });

    it("should parse string flags with values", async () => {
      const result = await parseArgs(
        ["create", "--task_description", "Fix bug"],
        tools,
      );
      expect(result.toolArgs?.task_description).toBe("Fix bug");
    });

    it("should parse string flags using aliases", async () => {
      const result = await parseArgs(["create", "-d", "Fix bug"], tools);
      expect(result.toolArgs?.task_description).toBe("Fix bug");
    });

    it("should parse boolean flags without values", async () => {
      const result = await parseArgs(
        ["archive", "-i", "task123", "--has_branch_removal"],
        tools,
      );
      expect(result.toolArgs?.has_branch_removal).toBe(true);
    });

    it("should parse boolean flags using aliases", async () => {
      const result = await parseArgs(["archive", "-i", "task123", "-r"], tools);
      expect(result.toolArgs?.has_branch_removal).toBe(true);
    });

    it("should parse multiple flags", async () => {
      const result = await parseArgs(
        ["create", "-d", "Task", "-b", "main", "-p", "/path/to/repo"],
        tools,
      );
      expect(result.toolArgs?.task_description).toBe("Task");
      expect(result.toolArgs?.base_branch).toBe("main");
      expect(result.toolArgs?.git_repo_path).toBe("/path/to/repo");
    });

    it("should handle positional argument for first string param", async () => {
      const result = await parseArgs(["create", "Fix bug"], tools);
      expect(result.toolArgs?.task_description).toBe("Fix bug");
    });

    it("should throw error for unknown flag", async () => {
      await expect(parseArgs(["create", "--unknown"], tools)).rejects.toThrow(
        "Unknown flag: --unknown",
      );
    });

    it("should throw error when string flag missing value", async () => {
      await expect(parseArgs(["create", "-d"], tools)).rejects.toThrow(
        "Flag -d requires a value",
      );
    });

    it("should throw error for unexpected positional argument", async () => {
      await expect(
        parseArgs(["create", "first", "second"], tools),
      ).rejects.toThrow("Unexpected argument: second");
    });

    it("should detect boolean type from parameter name patterns", async () => {
      const result = await parseArgs(["archive", "-r"], tools);
      expect(result.toolArgs?.has_branch_removal).toBe(true);
    });

    it("should handle tools without CLI config", async () => {
      const toolWithoutCli: McpTool = {
        name: "no_cli_tool",
        description: "Test",
        parameters: () => ({}),
        cb: async () => ({ content: [] }),
      };

      const result = await parseArgs(["no_cli_tool"], [toolWithoutCli]);
      expect(result.toolName).toBe("no_cli_tool");
      expect(result.toolArgs).toEqual({});
    });

    it("should return tool mode for unknown tool names", async () => {
      const result = await parseArgs(["unknown_tool"], tools);
      expect(result.mode).toBe("tool");
      expect(result.toolName).toBe("unknown_tool");
      expect(result.toolArgs).toEqual({});
    });

    it("should handle long flag format (--flag)", async () => {
      const result = await parseArgs(
        ["archive", "--worktree_identifier", "/path"],
        tools,
      );
      expect(result.toolArgs?.worktree_identifier).toBe("/path");
    });

    it("should handle short flag format (-f)", async () => {
      const result = await parseArgs(["archive", "-i", "/path"], tools);
      expect(result.toolArgs?.worktree_identifier).toBe("/path");
    });

    it("should resolve 'rm' alias to archive", async () => {
      const result = await parseArgs(["rm", "-i", "/path"], tools);
      expect(result.toolName).toBe("archive");
      expect(result.toolArgs?.worktree_identifier).toBe("/path");
    });

    it("should resolve 'init' alias to doctor", async () => {
      const result = await parseArgs(["init"], tools);
      expect(result.toolName).toBe("doctor");
    });
  });

  describe("buildToolAliases", () => {
    it("should build alias map for all tools", () => {
      const aliases = buildToolAliases(tools);

      expect(aliases["create"]).toBe("create");
      expect(aliases["new"]).toBe("create");
      expect(aliases["list"]).toBe("list");
      expect(aliases["archive"]).toBe("archive");
      expect(aliases["rm"]).toBe("archive");
      expect(aliases["doctor"]).toBe("doctor");
      expect(aliases["init"]).toBe("doctor");
    });

    it("should handle tools without aliases", () => {
      const toolsWithoutAliases: McpTool[] = [
        {
          name: "test_tool",
          description: "Test",
          parameters: () => ({}),
          cb: async () => ({ content: [] }),
        },
      ];

      const aliases = buildToolAliases(toolsWithoutAliases);
      expect(Object.keys(aliases)).toHaveLength(0);
    });

    it("should return empty object for empty tools array", () => {
      const aliases = buildToolAliases([]);
      expect(aliases).toEqual({});
    });
  });
});
