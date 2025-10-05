// MCP Tool Types - Type definitions for Model Context Protocol tools: tool interface, parameter schemas, response formats

import { WorktreeManager } from "@/src/worktree/manager";
import { z, type ZodType } from "zod";

type ZodNamespace = typeof z;

export type McpTool = {
  name: string;
  description: string;
  aliases?: string[];
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
