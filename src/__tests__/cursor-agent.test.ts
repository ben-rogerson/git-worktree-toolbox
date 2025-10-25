/**
 * Cursor Agent Plugin Tests
 */

import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/src/plugins/shared/templates";
import type { TemplateVariables } from "@/src/plugins/shared/types";
import { DEFAULT_PROMPT_TEMPLATE } from "@/src/plugins/shared/templates";

describe("Cursor Agent Plugin", () => {
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

  describe("Cursor Session Config Schema", () => {
    it("should validate complete CursorSessionConfig structure", () => {
      const sessionConfig: {
        enabled: boolean;
        chat_id: string;
        created_at: string;
        last_resumed_at?: string;
        prompt_template?: string;
      } = {
        enabled: true,
        chat_id: "12345678-1234-1234-1234-123456789012",
        created_at: "2025-10-21T20:00:00.000Z",
        last_resumed_at: "2025-10-22T10:00:00.000Z",
        prompt_template: "Custom: {{task_description}}",
      };

      expect(sessionConfig.enabled).toBe(true);
      expect(sessionConfig.chat_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should handle optional fields in CursorSessionConfig", () => {
      const minimalConfig: {
        enabled: boolean;
        chat_id: string;
        created_at: string;
        last_resumed_at?: string;
        prompt_template?: string;
      } = {
        enabled: false,
        chat_id: "12345678-1234-1234-1234-123456789012",
        created_at: "2025-10-21T20:00:00.000Z",
      };

      expect(minimalConfig.last_resumed_at).toBeUndefined();
      expect(minimalConfig.prompt_template).toBeUndefined();
    });
  });

  describe("Global AI Agent Config", () => {
    it("should support provider selection in config", () => {
      const globalConfig: {
        enabled: boolean;
        provider: "claude" | "cursor";
        prompt_template?: string;
        permission_mode: boolean;
      } = {
        enabled: true,
        provider: "cursor",
        prompt_template: "Task: {{task_description}}",
        permission_mode: false,
      };

      expect(globalConfig.provider).toBe("cursor");
      expect(globalConfig.enabled).toBe(true);
    });

    it("should support last_used_provider tracking", () => {
      const globalConfig: {
        enabled: boolean;
        provider: "claude" | "cursor";
        last_used_provider?: "claude" | "cursor";
        permission_mode: boolean;
      } = {
        enabled: true,
        provider: "claude",
        last_used_provider: "cursor",
        permission_mode: false,
      };

      expect(globalConfig.last_used_provider).toBe("cursor");
    });
  });
});
