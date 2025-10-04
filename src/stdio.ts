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

function parseArgs(): {
  mode: "server" | "version" | "help" | "tool";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
} {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return { mode: "server" };
  }

  const firstArg = args[0];

  // Check for version flag
  if (firstArg === "--version" || firstArg === "-v") {
    return { mode: "version" };
  }

  // Check for help flag
  if (firstArg === "--help" || firstArg === "-h") {
    return { mode: "help" };
  }

  // Direct tool call
  return {
    mode: "tool",
    toolName: firstArg,
    toolArgs: args[1] ? JSON.parse(args[1]) : {},
  };
}

async function runServer() {
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
  console.info(
    `Git Worktree Toolbox ${packageJson.version} MCP Server running on stdio`,
  );
}

// TODO: Get these from the tools/index.ts file
const TOOL_ALIASES: Record<string, string> = {
  new: "create task workspace",
  create: "create task workspace",
  archive: "archive workspace",
  launch: "launch workspace",
  list: "list workspaces",
  info: "get workspace info",
  init: "initialize workspace metadata",
  changes: "list changes from specific workspace",
  commit: "force commit workspace",
  merge: "merge remote workspace changes into local",
  projects: "list projects",
  mr: "generate mr link",
};

async function runTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<void> {
  const workspaceTools = await loadWorkspaceTools();

  const config = {
    base_worktrees_path: process.env.BASE_WORKTREES_PATH,
    project_directories:
      process.env.PROJECT_DIRECTORIES?.split(":").filter(Boolean),
  };

  const { WorkspaceManager } = await import("./workspace/manager.js");
  const workspaceManager = new WorkspaceManager(config);

  const resolvedToolName = TOOL_ALIASES[toolName] || toolName;
  const tool = workspaceTools.tools.find((t) => t.name === resolvedToolName);
  if (!tool) {
    throw new Error(
      `Unknown tool: ${toolName}. Run 'gwtree --help' to see available tools.`,
    );
  }

  const result = await tool.cb(toolArgs, { workspaceManager });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const parsed = parseArgs();

  switch (parsed.mode) {
    case "version":
      console.log(`✨ v${packageJson.version}`);
      process.exit(0);
      break;

    case "help": {
      const workspaceTools = await loadWorkspaceTools();
      console.log(`🌳 Git Worktree Toolbox ${packageJson.version} CLI\n`);
      console.log("Usage:");
      console.log(
        "  gwtree                          Start MCP server on stdio",
      );
      console.log("  gwtree --version, -v            Show version");
      console.log("  gwtree --help, -h               Show this help");
      console.log(
        "  gwtree [tool] [args]            Run tool directly (args as JSON)\n",
      );
      console.log("🛠️  Available tools:\n");

      const aliasMap = new Map<string, string[]>();
      for (const [alias, toolName] of Object.entries(TOOL_ALIASES)) {
        if (!aliasMap.has(toolName)) {
          aliasMap.set(toolName, []);
        }
        aliasMap.get(toolName)?.push(alias);
      }

      for (const tool of workspaceTools.tools) {
        const aliases = aliasMap.get(tool.name);
        const aliasText = aliases ? ` (${aliases.join(", ")})` : "";
        console.log(`  ${tool.name}${aliasText}`);
        console.log(`    ${tool.description}\n`);
      }
      process.exit(0);
      break;
    }

    case "tool":
      if (!parsed.toolName) {
        throw new Error("Tool name is required");
      }
      await runTool(parsed.toolName, parsed.toolArgs || {});
      process.exit(0);
      break;

    case "server":
      await runServer();
      break;
  }
}

// Handle errors
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
