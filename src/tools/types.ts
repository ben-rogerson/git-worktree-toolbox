// MCP Tool Types - Type definitions for Model Context Protocol tools: tool interface, parameter schemas, response formats

import { WorktreeManager } from "@/src/worktree/manager";
import { z, type ZodType } from "zod";
import { CliConfig } from "@/src/schemas/config-schema";

type ZodNamespace = typeof z;

export type McpTool = {
  name: string;
  description: string;
  cli?: CliConfig;
  cliFooter?: string;
  mcpFooter?: string;
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
