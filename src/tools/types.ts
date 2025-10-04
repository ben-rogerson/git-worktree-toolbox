// MCP Tool Types - Type definitions for Model Context Protocol tools: tool interface, parameter schemas, response formats

import { WorkspaceManager } from "@/src/workspace/manager";
import { z, type ZodType } from "zod";

type ZodNamespace = typeof z;

export type McpTool = {
  name: string;
  description: string;
  parameters: (z: ZodNamespace) => Record<string, ZodType>;
  cb: (
    args: Record<string, unknown>,
    { workspaceManager }: { workspaceManager: WorkspaceManager },
  ) => Promise<{
    content: {
      type: "text" | "image";
      text?: string;
      image_data?: string;
    }[];
  }>;
};
