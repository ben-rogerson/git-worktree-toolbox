/**
 * CLI argument parser for gwtree - converts flags to tool arguments
 */

import type { McpTool } from "@/src/tools/types";

interface ParsedArgs {
  mode: "server" | "version" | "help" | "tool";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

/**
 * Determine parameter type from Zod schema
 */
function getParamType(
  tool: McpTool,
  paramName: string,
): "string" | "boolean" {
  try {
    const z = { string: () => ({}), boolean: () => ({}), optional: () => ({}) };
    const params = tool.parameters(z as never);
    const param = params[paramName];

    if (!param) {
      return "string";
    }

    // Simple heuristic: check if the param name or description suggests boolean
    const paramNameLower = paramName.toLowerCase();
    if (
      paramNameLower.startsWith("is_") ||
      paramNameLower.startsWith("has_") ||
      paramNameLower.startsWith("avoid_") ||
      paramNameLower.includes("_changes")
    ) {
      return "boolean";
    }

    return "string";
  } catch {
    return "string";
  }
}

/**
 * Parse CLI arguments into tool name and arguments
 */
export async function parseArgs(
  argv: string[],
  tools: McpTool[],
): Promise<ParsedArgs> {
  if (argv.length === 0) {
    return { mode: "server" };
  }

  const firstArg = argv[0];

  // Check for version flag
  if (firstArg === "--version" || firstArg === "-v") {
    return { mode: "version" };
  }

  // Check for help flag
  if (firstArg === "--help" || firstArg === "-h") {
    return { mode: "help" };
  }

  // Find tool by name or alias
  const TOOL_ALIASES = buildToolAliases(tools);
  const resolvedToolName = TOOL_ALIASES[firstArg] || firstArg;
  const tool = tools.find((t) => t.name === resolvedToolName);

  if (!tool) {
    return {
      mode: "tool",
      toolName: firstArg,
      toolArgs: {},
    };
  }

  // Parse flags for the tool
  const toolArgs: Record<string, unknown> = {};
  let i = 1;

  while (i < argv.length) {
    const arg = argv[i];

    // Handle flag
    if (arg.startsWith("-")) {
      const flagName = arg.startsWith("--")
        ? arg.slice(2)
        : arg.slice(1).length === 1
          ? arg.slice(1)
          : arg.slice(1);

      // Find flag definition
      const flagDef = tool.cli?.flags?.find(
        (f) => f.param === flagName || f.alias === flagName,
      );

      if (!flagDef) {
        throw new Error(
          `Unknown flag: ${arg} for tool ${tool.name}. Run 'gwtree ${tool.name} --help' for available flags.`,
        );
      }

      const paramType = getParamType(tool, flagDef.param);

      if (paramType === "boolean") {
        toolArgs[flagDef.param] = true;
        i++;
      } else {
        // String flag - next arg is the value
        if (i + 1 >= argv.length) {
          throw new Error(`Flag ${arg} requires a value`);
        }
        toolArgs[flagDef.param] = argv[i + 1];
        i += 2;
      }
    } else {
      // Positional argument - treat as first string flag if none set yet
      const firstStringFlag = tool.cli?.flags?.find((f) => {
        const type = getParamType(tool, f.param);
        return type === "string";
      });

      if (firstStringFlag && !toolArgs[firstStringFlag.param]) {
        toolArgs[firstStringFlag.param] = arg;
        i++;
      } else {
        throw new Error(
          `Unexpected argument: ${arg}. Use flags instead (e.g., --${tool.cli?.flags?.[0]?.param} "${arg}")`,
        );
      }
    }
  }

  return {
    mode: "tool",
    toolName: tool.name,
    toolArgs,
  };
}

/**
 * Build tool aliases map
 */
export function buildToolAliases(tools: McpTool[]): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const tool of tools) {
    if (tool.cli?.aliases) {
      for (const alias of tool.cli.aliases) {
        aliases[alias] = tool.name;
      }
    }
  }

  return aliases;
}
