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
async function loadWorktreeTools() {
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
  const worktreeTools = await loadWorktreeTools();

  const transport = new StdioServerTransport();
  const server = new Server(
    {
      name: "git-worktree-toolbox",
      version: packageJson.version,
    },
    {
      capabilities: {
        tools: {
          ...worktreeTools.capabilities(),
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
  worktreeTools.register(server, config);

  // Connect transport and start server
  await server.connect(transport);
  console.info(
    `Git Worktree Toolbox ${packageJson.version} MCP Server running on stdio`,
  );
}

function buildToolAliases(
  tools: { name: string; aliases?: string[] }[],
): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const tool of tools) {
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        aliases[alias] = tool.name;
      }
    }
  }

  return aliases;
}

async function runTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<void> {
  const worktreeTools = await loadWorktreeTools();

  const config = {
    base_worktrees_path: process.env.BASE_WORKTREES_PATH,
    project_directories:
      process.env.PROJECT_DIRECTORIES?.split(":").filter(Boolean),
  };

  const { WorktreeManager } = await import("./worktree/manager.js");
  const worktreeManager = new WorktreeManager(config);

  const TOOL_ALIASES = buildToolAliases(worktreeTools.tools);
  const resolvedToolName = TOOL_ALIASES[toolName] || toolName;
  const tool = worktreeTools.tools.find((t) => t.name === resolvedToolName);
  if (!tool) {
    throw new Error(
      `Unknown tool: ${toolName}. Run 'gwtree --help' to see available tools.`,
    );
  }

  const result = await tool.cb(toolArgs, { worktreeManager });
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
      const worktreeTools = await loadWorktreeTools();
      const TOOL_ALIASES = buildToolAliases(worktreeTools.tools);
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
        const name = String(toolName);
        if (!aliasMap.has(name)) {
          aliasMap.set(name, []);
        }
        aliasMap.get(name)?.push(String(alias));
      }

      for (const tool of worktreeTools.tools) {
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
