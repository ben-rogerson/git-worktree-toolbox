/**
 * MCP Tool Registration - Registers all worktree tools with MCP server:
 * lifecycle tools, change management tools, project discovery tools
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorktreeManager } from "../worktree/manager.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpTool } from "./types.js";
import {
  MCP_TOOLS_LIST_REQUEST_SCHEMA,
  MCP_TOOLS_CALL_REQUEST_SCHEMA,
} from "@/src/schemas/config-schema";

// Worktree Lifecycle Tools
import {
  createTaskWorktree,
  archiveWorktree,
  launchWorktree,
  doctorWorktrees,
  cleanWorktrees,
} from "./worktree-lifecycle.js";

// Worktree Changes Tools
import {
  worktreeChanges,
  mergeRemoteWorktreeChangesIntoLocal,
} from "./worktree-changes.js";

// Project Discovery Tools
import { listProjects, generateMrLink } from "./project-discovery.js";

// Worktree Prompt Tool
import { worktreePrompt } from "./worktree-prompt.js";

export interface WorktreeMcpToolsConfig {
  base_worktrees_path?: string;
  project_directories?: string[];
}

export const tools = [
  // Discovery & Navigation
  listProjects,
  launchWorktree,
  // Worktree Lifecycle
  createTaskWorktree,
  worktreeChanges,
  archiveWorktree,
  cleanWorktrees,
  doctorWorktrees,
  // Integration
  generateMrLink,
  mergeRemoteWorktreeChangesIntoLocal,
  // Claude Prompt Plugin
  worktreePrompt,
] satisfies McpTool[];

export function register(server: Server, config: WorktreeMcpToolsConfig) {
  const worktreeManager = new WorktreeManager(config);

  server.setRequestHandler(MCP_TOOLS_LIST_REQUEST_SCHEMA, async () => ({
    tools: tools.map((tool) => {
      const schema = z.object(tool.parameters(z));
      const jsonSchema = zodToJsonSchema(schema, {
        target: "openApi3",
        $refStrategy: "none",
      });
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema,
      };
    }),
  }));

  server.setRequestHandler(
    MCP_TOOLS_CALL_REQUEST_SCHEMA,
    async (
      request,
    ): Promise<{
      content: { type: "text" | "image"; text?: string; image_data?: string }[];
    }> => {
      const tool: McpTool | undefined = tools.find(
        (t) => t.name === request.params.name,
      );
      if (!tool) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      const result = await tool.cb(request.params.arguments || {}, {
        worktreeManager,
      });

      // Append MCP footer if available
      if (tool.mcpFooter && result.content.length > 0) {
        const lastItem = result.content[result.content.length - 1];
        if (lastItem.type === "text" && lastItem.text) {
          lastItem.text += `\n\n${tool.mcpFooter}`;
        }
      }

      return result;
    },
  );
}

export function capabilities() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
