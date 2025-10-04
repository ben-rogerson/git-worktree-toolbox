/**
 * MCP Tool Registration - Registers all workspace tools with MCP server:
 * lifecycle tools, change management tools, project discovery tools
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorkspaceManager } from "../workspace/manager.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpTool } from "./types.js";

// Workspace Lifecycle Tools
import {
  createTaskWorkspace,
  archiveWorkspace,
  launchWorkspace,
  listWorkspaces,
  getWorkspaceInfo,
  initializeWorkspaceMetadata,
} from "./workspace-lifecycle.js";

// Workspace Changes Tools
import {
  listChangesFromSpecificWorkspace,
  forceCommitWorkspace,
  mergeRemoteWorkspaceChangesIntoLocal,
} from "./workspace-changes.js";

// Project Discovery Tools
import { listProjects, generateMrLink } from "./project-discovery.js";

export interface WorkspaceMcpToolsConfig {
  base_worktrees_path?: string;
  project_directories?: string[];
}

export const tools = [
  createTaskWorkspace,
  archiveWorkspace,
  launchWorkspace,
  listWorkspaces,
  getWorkspaceInfo,
  initializeWorkspaceMetadata,
  listChangesFromSpecificWorkspace,
  forceCommitWorkspace,
  mergeRemoteWorkspaceChangesIntoLocal,
  listProjects,
  generateMrLink,
] satisfies McpTool[];

export function register(server: Server, config: WorkspaceMcpToolsConfig) {
  const workspaceManager = new WorkspaceManager(config);

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
    async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      return tool.cb(request.params.arguments || {}, { workspaceManager });
    },
  );
}

export function capabilities() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
