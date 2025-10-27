/**
 * Worktree Prompt Tool Tests
 *
 * Tests for the worktree-prompt tool including provider switching,
 * session detection, and error handling scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { worktreePrompt } from "@/src/tools/worktree-prompt";
import {
  loadGlobalAIAgentConfig,
  saveGlobalAIAgentConfig,
  getGlobalConfigPath,
} from "@/src/plugins/shared/config";
import type { GlobalAIAgentConfig } from "@/src/plugins/shared/types";

// Mock the resume functions
vi.mock("@/src/plugins/claude-prompt/index", () => ({
  resumeClaudeSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/src/plugins/cursor-agent/index", () => ({
  resumeCursorSession: vi.fn().mockResolvedValue(undefined),
}));

describe("Worktree Prompt Tool", () => {
  const testConfigPath = getGlobalConfigPath();
  const backupPath = `${testConfigPath}.backup`;
  const testWorktreePath = "/tmp/test-worktree";
  const testMetadataPath = path.join(
    testWorktreePath,
    ".gwtree",
    "metadata.json",
  );

  // Mock worktree manager
  const mockWorktreeManager = {
    getWorktreeByPathOrTaskId: vi.fn(),
  } as any;

  beforeEach(() => {
    // Backup existing config
    if (fs.existsSync(testConfigPath)) {
      fs.copyFileSync(testConfigPath, backupPath);
    }

    // Create test worktree directory structure
    fs.mkdirSync(testWorktreePath, { recursive: true });
    fs.mkdirSync(path.dirname(testMetadataPath), { recursive: true });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore config
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, testConfigPath);
    } else if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }

    // Clean up test worktree
    if (fs.existsSync(testWorktreePath)) {
      fs.rmSync(testWorktreePath, { recursive: true, force: true });
    }
  });

  describe("Setup Command", () => {
    it("should setup Claude configuration", async () => {
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { setup: true, claude: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "✅ Claude configuration initialized!",
      );
      expect(result.content[0].text).toContain("Claude CLI will auto-launch");

      // Verify config was saved
      const config = await loadGlobalAIAgentConfig();
      expect(config?.provider).toBe("claude");
    });

    it("should setup Cursor configuration", async () => {
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { setup: true, cursor: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "✅ Cursor configuration initialized!",
      );
      expect(result.content[0].text).toContain("Cursor CLI will auto-launch");

      // Verify config was saved
      const config = await loadGlobalAIAgentConfig();
      expect(config?.provider).toBe("cursor");
    });

    it("should default to Claude when no provider specified", async () => {
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { setup: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "✅ Claude configuration initialized!",
      );

      // Verify config defaults to Claude
      const config = await loadGlobalAIAgentConfig();
      expect(config?.provider).toBe("claude");
    });
  });

  describe("Provider Switching Scenarios", () => {
    beforeEach(async () => {
      // Set up initial Claude config
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(claudeConfig);
    });

    it("should resume Claude session when provider is Claude and Claude session exists", async () => {
      const { resumeClaudeSession } = await import(
        "@/src/plugins/claude-prompt/index"
      );

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "test-session-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      expect(resumeClaudeSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        sessionId: "test-session-id",
        prompt: "test prompt",
        permissionMode: undefined,
      });

      expect(result.content[0].text).toContain("✨ Claude session resumed!");
      expect(result.content[0].text).toContain("test-session-id");
    });

    it("should resume Cursor session when provider is Cursor and Cursor session exists", async () => {
      const { resumeCursorSession } = await import(
        "@/src/plugins/cursor-agent/index"
      );

      // Switch to Cursor provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          cursor_session: {
            enabled: true,
            chat_id: "test-chat-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      expect(resumeCursorSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        chatId: "test-chat-id",
        prompt: "test prompt",
        forceMode: undefined,
      });

      expect(result.content[0].text).toContain("✨ Cursor session resumed!");
      expect(result.content[0].text).toContain("test-chat-id");
    });

    it("should automatically create new Cursor session when switching from Claude", async () => {
      const { resumeCursorSession } = await import(
        "@/src/plugins/cursor-agent/index"
      );

      // Switch to Cursor provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "test-session-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      expect(resumeCursorSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        chatId: expect.any(String),
        prompt: "test prompt",
        forceMode: undefined,
      });

      expect(result.content[0].text).toContain(
        "✨ Created new Cursor session!",
      );
      expect(result.content[0].text).toContain("test-worktree");
      expect(result.content[0].text).toContain(
        "Cursor Agent CLI is now running",
      );
    });

    it("should automatically create new Claude session when switching from Cursor", async () => {
      const { resumeClaudeSession } = await import(
        "@/src/plugins/claude-prompt/index"
      );

      // Keep Claude as provider (from beforeEach)
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          cursor_session: {
            enabled: true,
            chat_id: "test-chat-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      expect(resumeClaudeSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        sessionId: expect.any(String),
        prompt: "test prompt",
        permissionMode: undefined,
      });

      expect(result.content[0].text).toContain(
        "✨ Created new Claude session!",
      );
      expect(result.content[0].text).toContain("test-worktree");
      expect(result.content[0].text).toContain("Claude CLI is now running");
    });

    it("should show error when no sessions exist at all", async () => {
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("❌ No AI agent session found");
      expect(result.content[0].text).toContain(
        "This worktree was not created with any AI agent prompt plugin enabled",
      );
      expect(result.content[0].text).toContain("gwtree prompt setup --claude");
    });
  });

  describe("Session Detection Logic", () => {
    beforeEach(async () => {
      // Set up Claude config for session detection tests
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(claudeConfig);
    });

    it("should detect Claude session correctly", async () => {
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "claude-session-123",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        {},
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("✨ Claude session resumed!");
      expect(result.content[0].text).toContain("claude-session-123");
    });

    it("should detect Cursor session correctly", async () => {
      // Set Cursor as provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          cursor_session: {
            enabled: true,
            chat_id: "cursor-chat-456",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        {},
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain("✨ Cursor session resumed!");
      expect(result.content[0].text).toContain("cursor-chat-456");
    });

    it("should handle worktree not found", async () => {
      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(null);

      const result = await worktreePrompt.cb(
        { worktree_identifier: "nonexistent" },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "❌ Worktree not found: nonexistent",
      );
      expect(result.content[0].text).toContain(
        'Run "gwtree list" to see available worktrees',
      );
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      // Set up Claude config for error handling tests
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(claudeConfig);
    });

    it("should handle setup errors gracefully", async () => {
      // Mock an error in the worktree manager
      mockWorktreeManager.getWorktreeByPathOrTaskId.mockRejectedValue(
        new Error("Test error"),
      );

      const result = await worktreePrompt.cb(
        { setup: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "❌ Failed to initialize global config",
      );
      expect(result.content[0].text).toContain("Test error");
    });

    it("should handle session resume errors gracefully", async () => {
      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "test-session-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      // Mock an error in resumeClaudeSession
      const { resumeClaudeSession } = await import(
        "@/src/plugins/claude-prompt/index"
      );
      (resumeClaudeSession as any).mockRejectedValue(
        new Error("Resume failed"),
      );

      const result = await worktreePrompt.cb(
        {},
        { worktreeManager: mockWorktreeManager },
      );

      expect(result.content[0].text).toContain(
        "❌ Failed to resume AI agent session",
      );
      expect(result.content[0].text).toContain("Resume failed");
    });
  });

  describe("Edge Cases and Advanced Switching", () => {
    beforeEach(async () => {
      // Set up Claude config for edge case tests
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(claudeConfig);
    });

    it("should handle switching when both sessions exist", async () => {
      const { resumeClaudeSession } = await import(
        "@/src/plugins/claude-prompt/index"
      );

      // Ensure mock is set to resolve successfully
      (resumeClaudeSession as any).mockClear();
      (resumeClaudeSession as any).mockResolvedValue(undefined);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          team: { assigned_users: [] },
          conversation_history: [],
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "claude-session-id",
            created_at: new Date().toISOString(),
          },
          cursor_session: {
            enabled: true,
            chat_id: "cursor-chat-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      // Should resume Claude session since provider is Claude
      expect(resumeClaudeSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        sessionId: "claude-session-id",
        prompt: "test prompt",
        permissionMode: undefined,
      });

      expect(result.content[0].text).toContain("✨ Claude session resumed!");
    });

    it("should handle switching with disabled sessions", async () => {
      const { resumeCursorSession } = await import(
        "@/src/plugins/cursor-agent/index"
      );

      // Switch to Cursor provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: false, // Disabled session
            session_id: "claude-session-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      // Should create new Cursor session since Claude session is disabled
      expect(resumeCursorSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        chatId: expect.any(String),
        prompt: "test prompt",
        forceMode: undefined,
      });

      expect(result.content[0].text).toContain(
        "✨ Created new Cursor session!",
      );
    });

    it("should handle switching with malformed session data", async () => {
      const { resumeCursorSession } = await import(
        "@/src/plugins/cursor-agent/index"
      );

      // Ensure mock is set to resolve successfully
      (resumeCursorSession as any).mockClear();
      (resumeCursorSession as any).mockResolvedValue(undefined);

      // Switch to Cursor provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          team: { assigned_users: [] },
          conversation_history: [],
          git_info: { base_branch: "main" },
          claude_session: {
            // Malformed session - missing required fields
            enabled: true,
            // session_id missing
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      const result = await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      // Since Claude session is malformed (no session_id), hasClaudeSession will be false
      // The code doesn't detect it as a malformed session, just treats it as no session
      // So it returns the "No AI agent session found" message
      expect(result.content[0].text).toContain("No AI agent session found");
    });

    it("should preserve metadata during switching", async () => {
      // Import cursor-agent to ensure module is loaded
      await import("@/src/plugins/cursor-agent/index");

      // Switch to Cursor provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          team: { assigned_users: [] },
          conversation_history: [],
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "claude-session-id",
            created_at: new Date().toISOString(),
          },
          // Additional metadata that should be preserved
          custom_data: { some: "value" },
        } as any, // Use 'as any' to allow cursor_session to be added dynamically
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      await worktreePrompt.cb(
        { prompt: "test prompt" },
        { worktreeManager: mockWorktreeManager },
      );

      // Verify that metadata was saved with new session
      expect(mockWorktree.metadata.cursor_session).toBeDefined();
      expect(mockWorktree.metadata.cursor_session.enabled).toBe(true);
      expect(mockWorktree.metadata.cursor_session.chat_id).toBeDefined();

      // Verify that other metadata is preserved
      expect(mockWorktree.metadata.custom_data).toEqual({ some: "value" });
      expect(mockWorktree.metadata.claude_session).toBeDefined();
    });
  });

  describe("Yolo Mode", () => {
    beforeEach(async () => {
      // Set up Claude config for yolo mode tests
      const claudeConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "claude",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(claudeConfig);
    });

    it("should pass yolo flag to Claude session", async () => {
      const { resumeClaudeSession } = await import(
        "@/src/plugins/claude-prompt/index"
      );

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          claude_session: {
            enabled: true,
            session_id: "test-session-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      await worktreePrompt.cb(
        { yolo: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(resumeClaudeSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        sessionId: "test-session-id",
        prompt: undefined,
        permissionMode: true,
      });
    });

    it("should pass yolo flag to Cursor session", async () => {
      const { resumeCursorSession } = await import(
        "@/src/plugins/cursor-agent/index"
      );

      // Set Cursor as provider
      const cursorConfig: GlobalAIAgentConfig = {
        enabled: true,
        provider: "cursor",
        permission_mode: false,
      };
      await saveGlobalAIAgentConfig(cursorConfig);

      const mockWorktree = {
        worktreePath: testWorktreePath,
        metadata: {
          worktree: { name: "test-worktree", branch: "main" },
          git_info: { base_branch: "main" },
          cursor_session: {
            enabled: true,
            chat_id: "test-chat-id",
            created_at: new Date().toISOString(),
          },
        },
      };

      mockWorktreeManager.getWorktreeByPathOrTaskId.mockResolvedValue(
        mockWorktree,
      );

      await worktreePrompt.cb(
        { yolo: true },
        { worktreeManager: mockWorktreeManager },
      );

      expect(resumeCursorSession).toHaveBeenCalledWith({
        worktreePath: testWorktreePath,
        chatId: "test-chat-id",
        prompt: undefined,
        forceMode: true,
      });
    });
  });
});
