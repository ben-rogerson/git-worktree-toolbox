#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

// Import all tools
async function loadWorkspaceTools() {
  try {
    const toolsModule = await import("./tools/index.js");
    return toolsModule;
  } catch (error) {
    console.error("Error loading tools:", error);
    throw error;
  }
}

async function main() {
  const workspaceTools = await loadWorkspaceTools();

  const transport = new StdioServerTransport();
  const server = new Server(
    {
      name: "git-worktree-toolbox",
      version: packageJson.version,
    },
    {
      capabilities: {
        tools: {
          ...workspaceTools.capabilities(),
        },
      },
    },
  );

  // Register tools
  const config = {
    base_worktrees_path: process.env.BASE_WORKTREES_PATH,
    project_directories:
      process.env.PROJECT_DIRECTORIES?.split(":").filter(Boolean),
  };
  workspaceTools.register(server, config);

  // Connect transport and start server
  await server.connect(transport);
  console.info("Git Worktree Toolbox MCP Server running on stdio");
}

// Handle errors
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
