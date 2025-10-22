# Claude Prompt Plugin

Auto-launch Claude CLI when creating worktrees, with persistent session support for ongoing conversations.

## Overview

The Claude Prompt plugin integrates Claude CLI with git worktrees, automatically launching Claude with task context when you create a new worktree. Sessions are persistent and can be resumed later, maintaining conversation history across work sessions.

## Features

- **Auto-launch**: Claude CLI starts automatically when creating worktrees
- **Session persistence**: Each worktree gets a unique Claude session ID
- **Resume capability**: Continue conversations later with `gwtree prompt`
- **Context-aware prompts**: Initial prompts include task description, branch info, and worktree path
- **Customizable templates**: Define your own prompt templates globally or per-worktree
- **Non-blocking**: Claude launches in background, doesn't block worktree creation
- **Graceful fallback**: If Claude CLI isn't installed, worktree creation continues normally

## Prerequisites

1. **Claude CLI** must be installed and authenticated
   - Install from: https://claude.ai/download
   - Authenticate: `claude login`

2. **Git Worktree Toolbox** (this package)
   ```bash
   npm install -g git-worktree-toolbox
   ```

## Setup

### 1. Initialize Plugin Configuration

Run the setup command to create global defaults:

```bash
gwtree prompt --setup
```

This creates `~/.gwtree/claude-prompt.yaml` with these defaults:

```yaml
enabled: true
prompt_template: |
  You are my coding assistant as I begin work in this new worktree:

  Task: {{task_description}}
  Branch: {{branch}}
  Base branch: {{base_branch}}
  Worktree path: {{worktree_path}}

  Try not to ask me questions, just proceed with the following steps:
  1. Analyze the codebase and related files for the task.
  2. Determine the best implementation approach and identify potential issues.
  3. Create an actionable checklist of the steps needed to complete the task.
  4. Begin the task and complete it.
  5. Respond with a concise summary of the task and the results.
```

### 2. Customize Template (Optional)

Edit `~/.gwtree/claude-prompt.yaml` to customize the initial prompt:

```yaml
enabled: true
prompt_template: |
  New feature branch: {{branch}}
  Task: {{task_description}}

  Steps:
  1. Review related code
  2. Suggest implementation approach
  3. Identify potential issues
```

Available template variables:

- `{{task_description}}` - Task description from `gwtree new`
- `{{branch}}` - New branch name
- `{{base_branch}}` - Base branch (usually main/master)
- `{{worktree_path}}` - Full path to worktree directory
- `{{worktree_name}}` - Worktree folder name

## Usage

### Creating Worktrees with Claude

```bash
# Create a new worktree - Claude auto-launches
gwtree new "Add user authentication feature"

# Claude CLI starts in the worktree directory with context
# Session ID is saved in worktree metadata
```

### Resuming Claude Sessions

```bash
# Resume by worktree name
gwtree prompt user-authentication-123

# Resume by task ID
gwtree prompt a1b2c3d4-5678-90ab-cdef-1234567890ab

# Resume by worktree path
gwtree prompt /path/to/worktree

# Resume with a specific prompt (for scripting)
gwtree prompt user-auth-123 -m "Run the test suite"
```

### Disabling for Specific Worktrees

Edit the worktree's metadata file:

```bash
# Find the metadata path
ls ~/.gwtree/metadata/

# Edit task.config.yaml
vim ~/.gwtree/metadata/<hash>/task.config.yaml
```

Set `enabled: false`:

```yaml
claude_session:
  enabled: false
  session_id: "..."
  created_at: "..."
```

### Disabling Globally

Edit `~/.gwtree/claude-prompt.yaml`:

```yaml
enabled: false
```

New worktrees will not launch Claude automatically. Existing worktrees with sessions can still be resumed.

## How It Works

### 1. Worktree Creation Flow

```
gwtree new "task"
  → Create git worktree
  → Create metadata
  → Check if Claude plugin enabled
  → Generate session UUID
  → Render prompt template
  → Save session to metadata
  → Spawn: claude -p "<prompt>" --session-id <uuid>
  → Return control to user
```

### 2. Session Resume Flow

```
gwtree prompt <identifier>
  → Load worktree metadata
  → Get session_id from claude_session field
  → Spawn: claude --resume <session-id>
  → Update last_resumed_at timestamp
```

### 3. Metadata Storage

Session data is stored in each worktree's metadata file at:

```
~/.gwtree/metadata/<path-hash>/task.config.yaml
```

Example metadata:

```yaml
worktree:
  id: "a1b2c3d4..."
  name: "user-authentication-123"
  branch: "feature/user-auth"
  # ...

claude_session:
  enabled: true
  session_id: "f9e8d7c6-5432-10ab-cdef-1234567890ab"
  created_at: "2025-10-21T20:30:00.000Z"
  last_resumed_at: "2025-10-22T09:15:00.000Z"
  prompt_template: "..." # Optional override
```

## Examples

### Example 1: Feature Development Workflow

```bash
# Setup (one-time)
gwtree prompt --setup

# Start new feature
gwtree new "Implement OAuth login"
# → Claude launches with context
# → Work with Claude to plan implementation
# → Close terminal when done

# Resume next day
gwtree prompt oauth-login-456
# → Claude resumes with full conversation history
# → Continue implementation

# Commit and push when ready
gwtree changes oauth-login-456 -c
```

### Example 2: Bug Fix with Claude

```bash
# Create worktree for bug fix
gwtree new "Fix null pointer in user service"
# → Claude auto-launches
# → Ask: "Where is the user service code?"
# → Claude analyzes and shows relevant files

# Resume later to verify fix
gwtree prompt null-pointer-789 -m "Verify the fix works correctly"
```

### Example 3: Custom Template for Testing

Edit `~/.gwtree/claude-prompt.yaml`:

```yaml
enabled: true
prompt_template: |
  Test task: {{task_description}}
  Branch: {{branch}}

  Please:
  1. Find related test files
  2. Run existing tests
  3. Suggest new test cases needed
```

## Troubleshooting

### Claude CLI Not Found

Error: `Claude CLI not found`

**Solution**: Install Claude CLI from https://claude.ai/download

### Session Not Found

Error: `No Claude session found for worktree`

**Cause**: Worktree was created before plugin was enabled

**Solution**:

1. Run `gwtree prompt --setup` to enable plugin
2. Create new worktrees (old ones won't have sessions)
3. Or manually add `claude_session` to worktree metadata

### Template Variables Not Replacing

**Cause**: Incorrect variable syntax in template

**Solution**: Use double curly braces: `{{variable}}` not `{variable}`

### Claude Launches But Closes Immediately

**Cause**: Using `-p/--print` flag in non-interactive environment

**Solution**: The plugin uses `-p` for initial prompt. Resume with `gwtree prompt` launches interactive session.

## Advanced Configuration

### Per-Worktree Templates

Override the template for a specific worktree by editing its metadata:

```yaml
claude_session:
  enabled: true
  session_id: "..."
  prompt_template: |
    Custom prompt for this specific worktree.
    Task: {{task_description}}
```

### Integration with CI/CD

Disable plugin in CI environments:

```bash
# In CI script
export GWTREE_SKIP_CLAUDE=true
gwtree new "automated task"
```

Add to plugin code:

```typescript
if (process.env.GWTREE_SKIP_CLAUDE === "true") {
  return; // Skip Claude launch
}
```

## Architecture

### Files

```
src/plugins/claude-prompt/
├── index.ts        # Core plugin logic (execute, resume)
├── types.ts        # TypeScript interfaces
├── config.ts       # Global config management
├── templates.ts    # Prompt template rendering
└── README.md       # This file

src/tools/
└── worktree-prompt.ts  # MCP tool for 'gwtree prompt'
```

### Integration Points

1. **WorktreeManager.createWorktree()** - Hook after metadata creation
2. **MCP Tools** - `prompt` tool for resume
3. **Metadata Schema** - `claude_session` field in YAML

## License

Same as parent project (MIT)
