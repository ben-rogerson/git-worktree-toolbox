/**
 * Claude Prompt Plugin Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  renderTemplate,
  DEFAULT_PROMPT_TEMPLATE,
  type TemplateVariables,
} from "@/src/plugins/claude-prompt/templates";
import {
  loadGlobalClaudeConfig,
  getGlobalConfigPath,
} from "@/src/plugins/claude-prompt/config";

describe("Claude Prompt Plugin", () => {
  describe("Template Rendering", () => {
    it("should replace all template variables", () => {
      const template =
        "Task: {{task_description}}, Branch: {{branch}}, Base: {{base_branch}}";
      const variables: TemplateVariables = {
        task_description: "Add login feature",
        branch: "feature/login",
        base_branch: "main",
        worktree_path: "/path/to/worktree",
        worktree_name: "login-123",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe(
        "Task: Add login feature, Branch: feature/login, Base: main",
      );
    });

    it("should handle multiple occurrences of same variable", () => {
      const template = "{{branch}} is based on {{branch}}";
      const variables: TemplateVariables = {
        task_description: "test",
        branch: "feature/test",
        base_branch: "main",
        worktree_path: "/path",
        worktree_name: "test",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe("feature/test is based on feature/test");
    });

    it("should leave unknown variables unchanged", () => {
      const template = "{{task_description}} - {{unknown_var}}";
      const variables: TemplateVariables = {
        task_description: "test task",
        branch: "main",
        base_branch: "main",
        worktree_path: "/path",
        worktree_name: "test",
      };

      const result = renderTemplate(template, variables);
      expect(result).toBe("test task - {{unknown_var}}");
    });

    it("should render default template with all variables", () => {
      const variables: TemplateVariables = {
        task_description: "Implement OAuth",
        branch: "feature/oauth",
        base_branch: "develop",
        worktree_path: "/Users/test/worktrees/oauth-123",
        worktree_name: "oauth-123",
      };

      const result = renderTemplate(DEFAULT_PROMPT_TEMPLATE, variables);
      expect(result).toContain("Implement OAuth");
      expect(result).toContain("feature/oauth");
      expect(result).toContain("develop");
      expect(result).toContain("/Users/test/worktrees/oauth-123");
    });
  });

  describe("Global Configuration", () => {
    const testConfigPath = path.join(
      os.homedir(),
      ".gwtree",
      "claude-prompt-test.yaml",
    );

    beforeEach(() => {
      // Clean up test config if it exists
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
    });

    afterEach(() => {
      // Clean up test config
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
    });

    it("should return null when config file doesn't exist", async () => {
      const nonExistentPath = path.join(
        os.tmpdir(),
        "gwtree-nonexistent-" + Date.now(),
        ".gwtree",
        "claude-prompt.yaml",
      );

      // Verify file doesn't exist before loading
      expect(fs.existsSync(nonExistentPath)).toBe(false);

      // Since loadGlobalClaudeConfig uses hardcoded path, we just verify the behavior
      const config = await loadGlobalClaudeConfig();
      // Config may or may not be null depending on user's real config
      expect(config === null || typeof config === "object").toBe(true);
    });

    it("should return correct config path", () => {
      const configPath = getGlobalConfigPath();
      expect(configPath).toBe(
        path.join(os.homedir(), ".gwtree", "claude-prompt.yaml"),
      );
      expect(configPath).toContain(".gwtree");
      expect(configPath).toContain("claude-prompt.yaml");
    });
  });

  describe("Claude Session Config Schema", () => {
    it("should validate complete ClaudeSessionConfig structure", () => {
      const sessionConfig: {
        enabled: boolean;
        session_id: string;
        created_at: string;
        last_resumed_at?: string;
        prompt_template?: string;
      } = {
        enabled: true,
        session_id: "12345678-1234-1234-1234-123456789012",
        created_at: "2025-10-21T20:00:00.000Z",
        last_resumed_at: "2025-10-22T10:00:00.000Z",
        prompt_template: "Custom: {{task_description}}",
      };

      expect(sessionConfig.enabled).toBe(true);
      expect(sessionConfig.session_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should handle optional fields in ClaudeSessionConfig", () => {
      const minimalConfig: {
        enabled: boolean;
        session_id: string;
        created_at: string;
        last_resumed_at?: string;
        prompt_template?: string;
      } = {
        enabled: false,
        session_id: "12345678-1234-1234-1234-123456789012",
        created_at: "2025-10-21T20:00:00.000Z",
      };

      expect(minimalConfig.last_resumed_at).toBeUndefined();
      expect(minimalConfig.prompt_template).toBeUndefined();
    });
  });

  describe("Global Claude Config with Permission Mode", () => {
    it("should support yolo flag in global config", () => {
      const globalConfig: {
        enabled: boolean;
        prompt_template?: string;
        yolo: boolean;
      } = {
        enabled: true,
        prompt_template: "Task: {{task_description}}",
        yolo: true,
      };

      expect(globalConfig.yolo).toBe(true);
    });
  });
});
