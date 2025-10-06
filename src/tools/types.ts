// MCP Tool Types - Type definitions for Model Context Protocol tools: tool interface, parameter schemas, response formats

import { WorktreeManager } from "@/src/worktree/manager";
import { z, type ZodType } from "zod";

type ZodNamespace = typeof z;

export type CliFlagDefinition = {
  param: string;
  alias: string;
  description: string;
};

export type CliConfig = {
  aliases?: string[];
  flags?: CliFlagDefinition[];
};

export type McpTool = {
  name: string;
  description: string;
  cli?: CliConfig;
  parameters: (z: ZodNamespace) => Record<string, ZodType>;
  cb: (
    args: Record<string, unknown>,
    { worktreeManager }: { worktreeManager: WorktreeManager },
  ) => Promise<{
    content: {
      type: "text" | "image";
      text?: string;
      image_data?: string;
    }[];
  }>;
};
