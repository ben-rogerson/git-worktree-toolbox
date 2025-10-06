/**
 * MCP Tool Registration - Registers all worktree tools with MCP server:
 * lifecycle tools, change management tools, project discovery tools
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorktreeManager } from "../worktree/manager.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpTool } from "./types.js";

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
] satisfies McpTool[];

export function register(server: Server, config: WorktreeMcpToolsConfig) {
  const worktreeManager = new WorktreeManager(config);

  server.setRequestHandler(
    z.object({
      method: z.literal("tools/list"),
    }),
    async () => ({
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
    }),
  );

  server.setRequestHandler(
    z.object({
      method: z.literal("tools/call"),
      params: z.object({
        name: z.string(),
        arguments: z.record(z.unknown()).optional(),
      }),
    }),
    async (
      request,
    ): Promise<{
      content: { type: "text" | "image"; text?: string; image_data?: string }[];
    }> => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      return tool.cb(request.params.arguments || {}, { worktreeManager });
    },
  );
}

export function capabilities() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
