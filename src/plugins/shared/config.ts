/**
 * Shared AI Agent Configuration
 *
 * Manages global configuration for AI agent plugins.
 * Unified config stored at ~/.gwtree/ai-agent.yaml
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { GlobalAIAgentConfig, AIAgentProvider } from "./types";
import { DEFAULT_PROMPT_TEMPLATE } from "./templates";

const GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".gwtree",
  "ai-agent.yaml",
);

export async function loadGlobalAIAgentConfig(): Promise<GlobalAIAgentConfig | null> {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
    return null;
  }

  try {
    const yamlContent = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8");
    const config = yaml.load(yamlContent) as GlobalAIAgentConfig;
    return config;
  } catch (error) {
    console.warn(`Failed to load global AI agent config: ${error}`);
    return null;
  }
}

export async function saveGlobalAIAgentConfig(
  config: GlobalAIAgentConfig,
): Promise<void> {
  try {
    const configDir = path.dirname(GLOBAL_CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const yamlContent = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      quotingType: '"',
    });

    fs.writeFileSync(GLOBAL_CONFIG_PATH, yamlContent, "utf8");
  } catch (error) {
    throw new Error(`Failed to save global AI agent config: ${error}`);
  }
}

export async function initializeGlobalAIAgentConfig(
  provider?: AIAgentProvider,
): Promise<void> {
  const existing = await loadGlobalAIAgentConfig();
  if (existing) {
    console.log("Global AI agent config already exists");
    return;
  }

  const defaultConfig: GlobalAIAgentConfig = {
    enabled: true,
    provider: provider || "claude",
    prompt_template: DEFAULT_PROMPT_TEMPLATE,
    permission_mode: false,
  };

  await saveGlobalAIAgentConfig(defaultConfig);
  console.log(`Created global AI agent config at ${GLOBAL_CONFIG_PATH}`);
}

export async function updateLastUsedProvider(
  provider: AIAgentProvider,
): Promise<void> {
  const config = await loadGlobalAIAgentConfig();
  if (!config) {
    throw new Error("No AI agent config found");
  }

  config.last_used_provider = provider;
  await saveGlobalAIAgentConfig(config);
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}
