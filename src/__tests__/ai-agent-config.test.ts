/**
 * AI Agent Config Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadGlobalAIAgentConfig,
  saveGlobalAIAgentConfig,
  getGlobalConfigPath,
  updateLastUsedProvider,
} from "@/src/plugins/shared/config";
import type { GlobalAIAgentConfig } from "@/src/plugins/shared/types";

describe("AI Agent Config", () => {
  const testConfigPath = getGlobalConfigPath();
  const backupPath = `${testConfigPath}.backup`;

  beforeEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.copyFileSync(testConfigPath, backupPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, testConfigPath);
    } else if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe("Config Loading and Saving", () => {
    it("should save and load config with claude provider", async () => {
      const config: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        prompt_template: "Test template",
        permission_mode: false,
      };

      await saveGlobalAIAgentConfig(config);
      const loaded = await loadGlobalAIAgentConfig();

      expect(loaded).not.toBeNull();
      expect(loaded?.provider).toBe("claude");
      expect(loaded?.enabled).toBe(true);
      expect(loaded?.prompt_template).toBe("Test template");
    });

    it("should save and load config with cursor provider", async () => {
      const config: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        prompt_template: "Cursor template",
        permission_mode: true,
      };

      await saveGlobalAIAgentConfig(config);
      const loaded = await loadGlobalAIAgentConfig();

      expect(loaded).not.toBeNull();
      expect(loaded?.provider).toBe("cursor");
      expect(loaded?.permission_mode).toBe(true);
    });

    it("should track last_used_provider", async () => {
      const config: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        last_used_provider: "cursor",
        permission_mode: false,
      };

      await saveGlobalAIAgentConfig(config);
      const loaded = await loadGlobalAIAgentConfig();

      expect(loaded?.last_used_provider).toBe("cursor");
    });

    it("should return null when config doesn't exist", async () => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }

      const loaded = await loadGlobalAIAgentConfig();
      expect(loaded).toBeNull();
    });
  });

  describe("Config Path", () => {
    it("should return correct config path", () => {
      const configPath = getGlobalConfigPath();
      expect(configPath).toBe(path.join(os.homedir(), ".gwtree", "ai-agent.yaml"));
      expect(configPath).toContain(".gwtree");
      expect(configPath).toContain("ai-agent.yaml");
    });
  });

  describe("Provider Types", () => {
    it("should enforce provider type constraints", () => {
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };

      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };

      expect(claudeConfig.provider).toBe("claude");
      expect(cursorConfig.provider).toBe("cursor");
    });
  });

  describe("updateLastUsedProvider", () => {
    it("should update last_used_provider for claude", async () => {
      const config: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };

      await saveGlobalAIAgentConfig(config);
      await updateLastUsedProvider("claude");

      const loaded = await loadGlobalAIAgentConfig();
      expect(loaded?.last_used_provider).toBe("claude");
    });

    it("should update last_used_provider for cursor", async () => {
      const config: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };

      await saveGlobalAIAgentConfig(config);
      await updateLastUsedProvider("cursor");

      const loaded = await loadGlobalAIAgentConfig();
      expect(loaded?.last_used_provider).toBe("cursor");
    });

    it("should throw error when no config exists", async () => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }

      await expect(updateLastUsedProvider("claude")).rejects.toThrow(
        "No AI agent config found",
      );
    });
  });

  describe("Provider Switching Scenarios", () => {
    it("should handle switching from claude to cursor", async () => {
      // Start with Claude config
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
        last_used_provider: "claude",
      };

      await saveGlobalAIAgentConfig(claudeConfig);
      let loaded = await loadGlobalAIAgentConfig();
      expect(loaded?.provider).toBe("claude");
      expect(loaded?.last_used_provider).toBe("claude");

      // Switch to Cursor
      const cursorConfig: GlobalAIAgentConfig = {
        ...claudeConfig,
        provider: "cursor",
        last_used_provider: "cursor",
      };

      await saveGlobalAIAgentConfig(cursorConfig);
      loaded = await loadGlobalAIAgentConfig();
      expect(loaded?.provider).toBe("cursor");
      expect(loaded?.last_used_provider).toBe("cursor");
    });

    it("should handle switching from cursor to claude", async () => {
      // Start with Cursor config
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
        last_used_provider: "cursor",
      };

      await saveGlobalAIAgentConfig(cursorConfig);
      let loaded = await loadGlobalAIAgentConfig();
      expect(loaded?.provider).toBe("cursor");
      expect(loaded?.last_used_provider).toBe("cursor");

      // Switch to Claude
      const claudeConfig: GlobalAIAgentConfig = {
        ...cursorConfig,
        provider: "claude",
        last_used_provider: "claude",
      };

      await saveGlobalAIAgentConfig(claudeConfig);
      loaded = await loadGlobalAIAgentConfig();
      expect(loaded?.provider).toBe("claude");
      expect(loaded?.last_used_provider).toBe("claude");
    });

    it("should preserve other config properties during switching", async () => {
      const originalConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: true,
        prompt_template: "Custom template",
        last_used_provider: "claude",
      };

      await saveGlobalAIAgentConfig(originalConfig);

      // Switch provider but preserve other properties
      const switchedConfig: GlobalAIAgentConfig = {
        ...originalConfig,
        provider: "cursor",
        last_used_provider: "cursor",
      };

      await saveGlobalAIAgentConfig(switchedConfig);
      const loaded = await loadGlobalAIAgentConfig();

      expect(loaded?.provider).toBe("cursor");
      expect(loaded?.last_used_provider).toBe("cursor");
      expect(loaded?.enabled).toBe(true);
      expect(loaded?.permission_mode).toBe(true);
      expect(loaded?.prompt_template).toBe("Custom template");
    });
  });
});
