#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseArgs, buildToolAliases } from "./cli-parser.js";
import type { McpTool } from "./tools/types.js";

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
  const { getGlobalConfig } = await import("./utils/constants.js");
  const globalConfig = getGlobalConfig();
  const config = {
    base_worktrees_path: globalConfig.baseWorktreesPath,
    project_directories: globalConfig.projectDirectories,
  };
  worktreeTools.register(server, config);

  // Connect transport and start server
  await server.connect(transport);
  console.info(
    `Git Worktree Toolbox ${packageJson.version} MCP Server running on stdio`,
  );
}

function getToolUsageExamples(tool: McpTool): string[] {
  const examples: string[] = [];

  if (tool.cli?.flags && tool.cli.flags.length > 0) {
    const firstStringFlag = tool.cli.flags.find((f) => {
      // Simple heuristic: if it's not a boolean flag
      return (
        f.param !== "has_branch_removal" &&
        f.param !== "push_changes" &&
        f.param !== "avoid_dry_run"
      );
    });

    if (firstStringFlag) {
      examples.push(`gwtree ${tool.name} <${firstStringFlag.param}>`);
      examples.push(
        `gwtree ${tool.name} --${firstStringFlag.param} <${firstStringFlag.param}>`,
      );

      // Show example with additional flags
      const booleanFlags = tool.cli.flags.filter(
        (f) =>
          f.param === "has_branch_removal" ||
          f.param === "push_changes" ||
          f.param === "avoid_dry_run",
      );

      if (booleanFlags.length > 0) {
        const exampleFlags = booleanFlags.map((f) => `--${f.param}`).join(" ");
        examples.push(
          `gwtree ${tool.name} <${firstStringFlag.param}> ${exampleFlags}`,
        );
      }
    }
  }

  return examples;
}

function showToolHelp(tool: McpTool): void {
  console.log(`🛠️  ${tool.name} - ${tool.description}\n`);

  if (tool.cli?.aliases && tool.cli.aliases.length > 0) {
    console.log(`Aliases: ${tool.cli.aliases.join(", ")}\n`);
  }

  // Show usage examples
  const usageExamples = getToolUsageExamples(tool);
  if (usageExamples.length > 0) {
    console.log("Usage:");
    for (const example of usageExamples) {
      console.log(`  ${example}`);
    }
    console.log("");
  }

  if (tool.cli?.flags && tool.cli.flags.length > 0) {
    console.log("Flags:");
    for (const flag of tool.cli.flags) {
      const aliasText = flag.alias ? `-${flag.alias}, ` : "";
      console.log(`  ${aliasText}--${flag.param}  ${flag.description}`);
    }
  } else {
    console.log("No flags available for this tool.");
  }

  console.log("");
}

async function runTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<void> {
  const worktreeTools = await loadWorktreeTools();

  const { getGlobalConfig } = await import("./utils/constants.js");
  const globalConfig = getGlobalConfig();
  const config = {
    base_worktrees_path: globalConfig.baseWorktreesPath,
    project_directories: globalConfig.projectDirectories,
  };

  const { WorktreeManager } = await import("./worktree/manager.js");
  const worktreeManager = new WorktreeManager(config);

  const TOOL_ALIASES = buildToolAliases(worktreeTools.tools);
  const resolvedToolName = TOOL_ALIASES[toolName] || toolName;
  const tool: McpTool | undefined = worktreeTools.tools.find(
    (t) => t.name === resolvedToolName,
  );
  if (!tool) {
    throw new Error(
      `Unknown tool: ${toolName}. Run 'gwtree --help' to see available tools.`,
    );
  }

  const result = await tool.cb(toolArgs, { worktreeManager });

  // Extract and print just the text from the response
  if (result.content && result.content.length > 0) {
    for (const item of result.content) {
      if (item.type === "text" && item.text) {
        let output = item.text;

        // Append CLI footer if available
        if (tool.cliFooter) {
          output += `\n\n${tool.cliFooter}`;
        }

        console.log(output);
      }
    }
  }
}

async function main() {
  const worktreeTools = await loadWorktreeTools();
  const parsed = await parseArgs(process.argv.slice(2), worktreeTools.tools);

  switch (parsed.mode) {
    case "version":
      console.log(`✨ v${packageJson.version}`);
      process.exit(0);
      break;

    case "help": {
      const TOOL_ALIASES = buildToolAliases(worktreeTools.tools);
      console.log(`🌳 Git Worktree Toolbox ${packageJson.version} CLI\n`);
      console.log("Usage:");
      console.log(
        "  gwtree                          Start MCP server on stdio",
      );
      console.log("  gwtree --version, -v            Show version");
      console.log("  gwtree --help, -h               Show this help");
      console.log("  gwtree [tool] [flags]           Run tool with flags\n");
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
        console.log(`    ${tool.description}`);

        // Show usage examples
        const usageExamples = getToolUsageExamples(tool);
        if (usageExamples.length > 0) {
          console.log(`    Usage:`);
          for (const example of usageExamples) {
            console.log(`      ${example}`);
          }
        }

        if (tool.cli?.flags && tool.cli.flags.length > 0) {
          console.log(`    Flags:`);
          for (const flag of tool.cli.flags) {
            console.log(
              `      -${flag.alias}, --${flag.param}  ${flag.description}`,
            );
          }
        }
        console.log("");
      }
      process.exit(0);
      break;
    }

    case "tool-help":
      if (!parsed.toolName) {
        throw new Error("Tool name is required");
      }
      const TOOL_ALIASES = buildToolAliases(worktreeTools.tools);
      const resolvedToolName = TOOL_ALIASES[parsed.toolName] || parsed.toolName;
      const tool = worktreeTools.tools.find((t) => t.name === resolvedToolName);
      if (!tool) {
        throw new Error(
          `Unknown tool: ${parsed.toolName}. Run 'gwtree --help' to see available tools.`,
        );
      }
      showToolHelp(tool);
      process.exit(0);
      break;

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
