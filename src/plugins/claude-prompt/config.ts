/**
 * Claude Prompt Plugin Configuration
 *
 * Manages global configuration for the Claude prompt plugin.
 * Global config is stored at ~/.gwtree/claude-prompt.yaml
 */

/**
 * Claude Prompt Plugin Configuration
 *
 * Manages legacy claude-prompt.yaml config and migrates to unified ai-agent.yaml
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { GlobalClaudeConfig } from "./types";
import { DEFAULT_PROMPT_TEMPLATE } from "./templates";
import {
  loadGlobalAIAgentConfig,
  saveGlobalAIAgentConfig,
} from "@/src/plugins/shared/config";
import type { GlobalAIAgentConfig } from "@/src/plugins/shared/types";

const LEGACY_CONFIG_PATH = path.join(
  os.homedir(),
  ".gwtree",
  "claude-prompt.yaml",
);

export async function loadGlobalClaudeConfig(): Promise<GlobalClaudeConfig | null> {
  const aiConfig = await loadGlobalAIAgentConfig();
  if (aiConfig) {
    return {
      enabled: aiConfig.enabled && aiConfig.provider === "claude",
      prompt_template: aiConfig.prompt_template,
      permission_mode: aiConfig.permission_mode,
    };
  }

  if (!fs.existsSync(LEGACY_CONFIG_PATH)) {
    return null;
  }

  try {
    const yamlContent = fs.readFileSync(LEGACY_CONFIG_PATH, "utf8");
    const config = yaml.load(yamlContent) as GlobalClaudeConfig;

    if (
      config.execution_mode !== undefined &&
      config.permission_mode === undefined
    ) {
      config.permission_mode = config.execution_mode;
      delete config.execution_mode;
    }

    const migratedConfig: GlobalAIAgentConfig = {
      enabled: config.enabled,
      provider: "claude",
      prompt_template: config.prompt_template,
      permission_mode: config.permission_mode,
    };

    await saveGlobalAIAgentConfig(migratedConfig);
    fs.unlinkSync(LEGACY_CONFIG_PATH);

    return config;
  } catch (error) {
    console.warn(`Failed to load global Claude config: ${error}`);
    return null;
  }
}

export async function saveGlobalClaudeConfig(
  config: GlobalClaudeConfig,
): Promise<void> {
  const aiConfig: GlobalAIAgentConfig = {
    enabled: config.enabled,
    provider: "claude",
    prompt_template: config.prompt_template,
    permission_mode: config.permission_mode,
  };

  await saveGlobalAIAgentConfig(aiConfig);
}

export async function initializeGlobalClaudeConfig(): Promise<void> {
  const existing = await loadGlobalClaudeConfig();
  if (existing) {
    console.log("Global Claude config already exists");
    return;
  }

  const defaultConfig: GlobalClaudeConfig = {
    enabled: true,
    prompt_template: DEFAULT_PROMPT_TEMPLATE,
    permission_mode: false,
  };

  await saveGlobalClaudeConfig(defaultConfig);
  console.log("Created global Claude config");
}

export function getGlobalConfigPath(): string {
  return LEGACY_CONFIG_PATH;
}
