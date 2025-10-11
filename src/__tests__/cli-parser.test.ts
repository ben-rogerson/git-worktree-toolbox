import { describe, it, expect } from "vitest";
import { parseArgs, buildToolAliases } from "../cli-parser";
import type { McpTool } from "../tools/types";

const mockTools: McpTool[] = [
  {
    name: "create_task_worktree",
    description: "Create a new worktree",
    parameters: (zod) => ({
      task_description: zod.string().describe("Task description"),
      user_id: zod.string().optional().describe("User ID"),
      avoid_conflicts: zod.boolean().optional().describe("Avoid conflicts"),
    }),
    cb: async () => ({ content: [] }),
    cli: {
      aliases: ["create", "new"],
      flags: [
        { param: "task_description", alias: "t", description: "Task" },
        { param: "user_id", alias: "u", description: "User" },
        { param: "avoid_conflicts", alias: "a", description: "Avoid conflicts" },
      ],
    },
  },
  {
    name: "list_projects",
    description: "List all projects",
    parameters: () => ({}),
    cb: async () => ({ content: [] }),
    cli: {
      aliases: ["list", "ls"],
    },
  },
  {
    name: "archive_worktree",
    description: "Archive a worktree",
    parameters: (zod) => ({
      path_or_task_id: zod.string().describe("Path or task ID"),
      is_complete: zod.boolean().optional().describe("Is complete"),
    }),
    cb: async () => ({ content: [] }),
    cli: {
      flags: [
        { param: "path_or_task_id", alias: "p", description: "Path" },
        { param: "is_complete", alias: "c", description: "Complete" },
      ],
    },
  },
];

describe("CLI Parser", () => {
  describe("parseArgs", () => {
    it("should return server mode when no args", async () => {
      const result = await parseArgs([], mockTools);
      expect(result.mode).toBe("server");
    });

    it("should return version mode for --version", async () => {
      const result = await parseArgs(["--version"], mockTools);
      expect(result.mode).toBe("version");
    });

    it("should return version mode for -v", async () => {
      const result = await parseArgs(["-v"], mockTools);
      expect(result.mode).toBe("version");
    });

    it("should return help mode for --help", async () => {
      const result = await parseArgs(["--help"], mockTools);
      expect(result.mode).toBe("help");
    });

    it("should return help mode for -h", async () => {
      const result = await parseArgs(["-h"], mockTools);
      expect(result.mode).toBe("help");
    });

    it("should return help mode for help", async () => {
      const result = await parseArgs(["help"], mockTools);
      expect(result.mode).toBe("help");
    });

    it("should resolve tool by name", async () => {
      const result = await parseArgs(["create_task_worktree"], mockTools);
      expect(result.mode).toBe("tool");
      expect(result.toolName).toBe("create_task_worktree");
    });

    it("should resolve tool by alias", async () => {
      const result = await parseArgs(["create"], mockTools);
      expect(result.toolName).toBe("create_task_worktree");
    });

    it("should parse string flags with values", async () => {
      const result = await parseArgs(
        ["create", "--task_description", "Fix bug"],
        mockTools,
      );
      expect(result.toolArgs?.task_description).toBe("Fix bug");
    });

    it("should parse string flags using aliases", async () => {
      const result = await parseArgs(["create", "-t", "Fix bug"], mockTools);
      expect(result.toolArgs?.task_description).toBe("Fix bug");
    });

    it("should parse boolean flags without values", async () => {
      const result = await parseArgs(
        ["create", "-t", "Task", "--avoid_conflicts"],
        mockTools,
      );
      expect(result.toolArgs?.avoid_conflicts).toBe(true);
    });

    it("should parse boolean flags using aliases", async () => {
      const result = await parseArgs(["create", "-t", "Task", "-a"], mockTools);
      expect(result.toolArgs?.avoid_conflicts).toBe(true);
    });

    it("should parse multiple flags", async () => {
      const result = await parseArgs(
        ["create", "-t", "Task", "-u", "user123", "-a"],
        mockTools,
      );
      expect(result.toolArgs?.task_description).toBe("Task");
      expect(result.toolArgs?.user_id).toBe("user123");
      expect(result.toolArgs?.avoid_conflicts).toBe(true);
    });

    it("should handle positional argument for first string param", async () => {
      const result = await parseArgs(["create", "Fix bug"], mockTools);
      expect(result.toolArgs?.task_description).toBe("Fix bug");
    });

    it("should throw error for unknown flag", async () => {
      await expect(
        parseArgs(["create", "--unknown"], mockTools),
      ).rejects.toThrow("Unknown flag: --unknown");
    });

    it("should throw error when string flag missing value", async () => {
      await expect(parseArgs(["create", "-t"], mockTools)).rejects.toThrow(
        "Flag -t requires a value",
      );
    });

    it("should throw error for unexpected positional argument", async () => {
      await expect(
        parseArgs(["create", "first", "second"], mockTools),
      ).rejects.toThrow("Unexpected argument: second");
    });

    it("should detect boolean type from parameter name patterns", async () => {
      const result = await parseArgs(["archive_worktree", "-c"], mockTools);
      expect(result.toolArgs?.is_complete).toBe(true);
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
      const result = await parseArgs(["unknown_tool"], mockTools);
      expect(result.mode).toBe("tool");
      expect(result.toolName).toBe("unknown_tool");
      expect(result.toolArgs).toEqual({});
    });

    it("should handle long flag format (--flag)", async () => {
      const result = await parseArgs(
        ["archive_worktree", "--path_or_task_id", "/path"],
        mockTools,
      );
      expect(result.toolArgs?.path_or_task_id).toBe("/path");
    });

    it("should handle short flag format (-f)", async () => {
      const result = await parseArgs(["archive_worktree", "-p", "/path"], mockTools);
      expect(result.toolArgs?.path_or_task_id).toBe("/path");
    });
  });

  describe("buildToolAliases", () => {
    it("should build alias map for all tools", () => {
      const aliases = buildToolAliases(mockTools);

      expect(aliases["create"]).toBe("create_task_worktree");
      expect(aliases["new"]).toBe("create_task_worktree");
      expect(aliases["list"]).toBe("list_projects");
      expect(aliases["ls"]).toBe("list_projects");
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
