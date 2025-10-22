/**
 * Claude Prompt Plugin Configuration
 *
 * Manages global configuration for the Claude prompt plugin.
 * Global config is stored at ~/.gwtree/claude-prompt.yaml
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { GlobalClaudeConfig } from "./types";
import { DEFAULT_PROMPT_TEMPLATE } from "./templates";

const GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".gwtree",
  "claude-prompt.yaml",
);

export async function loadGlobalClaudeConfig(): Promise<GlobalClaudeConfig | null> {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) {
    return null;
  }

  try {
    const yamlContent = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8");
    const config = yaml.load(yamlContent) as any;

    // Handle migration from execution_mode to permission_mode
    if (
      config.execution_mode !== undefined &&
      config.permission_mode === undefined
    ) {
      config.permission_mode = config.execution_mode;
      delete config.execution_mode;
      // Save the migrated config
      await saveGlobalClaudeConfig(config);
    }

    return config as GlobalClaudeConfig;
  } catch (error) {
    console.warn(`Failed to load global Claude config: ${error}`);
    return null;
  }
}

export async function saveGlobalClaudeConfig(
  config: GlobalClaudeConfig,
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
    throw new Error(`Failed to save global Claude config: ${error}`);
  }
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
  console.log(`Created global Claude config at ${GLOBAL_CONFIG_PATH}`);
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}
