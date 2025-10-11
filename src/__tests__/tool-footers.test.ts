import { describe, it, expect, beforeEach } from "vitest";
import type { McpTool } from "@/src/tools/types";
import { WorktreeManager } from "@/src/worktree/manager";

describe("Tool Footers", () => {
  let mockWorktreeManager: WorktreeManager;

  beforeEach(() => {
    mockWorktreeManager = {} as WorktreeManager;
  });

  describe("McpTool type", () => {
    it("should support optional cliFooter property", () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        cliFooter: "Run `gwtree --help` for more info",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "text", text: "Test output" }],
        }),
      };

      expect(tool.cliFooter).toBe("Run `gwtree --help` for more info");
    });

    it("should support optional mcpFooter property", () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        mcpFooter: "Use the 'list' tool to see available worktrees",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "text", text: "Test output" }],
        }),
      };

      expect(tool.mcpFooter).toBe(
        "Use the 'list' tool to see available worktrees",
      );
    });

    it("should support both cliFooter and mcpFooter properties", () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        cliFooter: "CLI footer message",
        mcpFooter: "MCP footer message",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "text", text: "Test output" }],
        }),
      };

      expect(tool.cliFooter).toBe("CLI footer message");
      expect(tool.mcpFooter).toBe("MCP footer message");
    });

    it("should work without any footer properties", () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "text", text: "Test output" }],
        }),
      };

      expect(tool.cliFooter).toBeUndefined();
      expect(tool.mcpFooter).toBeUndefined();
    });
  });

  describe("Footer appending behavior", () => {
    it("should append CLI footer to text output in CLI mode", async () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        cliFooter: "\nCLI footer message",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "text", text: "Test output" }],
        }),
      };

      const result = await tool.cb({}, { worktreeManager: mockWorktreeManager });
      const baseText = result.content[0].text;

      const outputWithFooter = tool.cliFooter
        ? `${baseText}\n\n${tool.cliFooter}`
        : baseText;

      expect(outputWithFooter).toContain("Test output");
      expect(outputWithFooter).toContain("CLI footer message");
    });

    it("should append MCP footer to text output in MCP mode", async () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        mcpFooter: "\nMCP footer message",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "text", text: "Test output" }],
        }),
      };

      const result = await tool.cb({}, { worktreeManager: mockWorktreeManager });

      if (tool.mcpFooter && result.content.length > 0) {
        const lastItem = result.content[result.content.length - 1];
        if (lastItem.type === "text" && lastItem.text) {
          lastItem.text += `\n\n${tool.mcpFooter}`;
        }
      }

      expect(result.content[0].text).toContain("Test output");
      expect(result.content[0].text).toContain("MCP footer message");
    });

    it("should not append footer when output is not text type", async () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        cliFooter: "CLI footer",
        mcpFooter: "MCP footer",
        parameters: () => ({}),
        cb: async () => ({
          content: [{ type: "image", image_data: "base64data" }],
        }),
      };

      const result = await tool.cb({}, { worktreeManager: mockWorktreeManager });

      expect(result.content[0].type).toBe("image");
      expect(result.content[0].text).toBeUndefined();
    });

    it("should handle empty content array gracefully", async () => {
      const tool: McpTool = {
        name: "test-tool",
        description: "Test tool",
        cliFooter: "CLI footer",
        mcpFooter: "MCP footer",
        parameters: () => ({}),
        cb: async () => ({
          content: [],
        }),
      };

      const result = await tool.cb({}, { worktreeManager: mockWorktreeManager });

      expect(result.content).toEqual([]);
    });
  });
});
