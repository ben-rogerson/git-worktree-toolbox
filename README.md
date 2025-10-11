# Git Worktree Toolbox

[![npm](https://img.shields.io/npm/v/git-worktree-toolbox?colorA=222222&colorB=333333)](https://www.npmjs.com/package/git-worktree-toolbox)
[![minzip package size](https://img.shields.io/bundlephobia/minzip/git-worktree-toolbox?label=minzip%20size&colorA=222222&colorB=333333)](https://bundlephobia.com/package/git-worktree-toolbox)

🌳 **Git Worktree Toolbox** is a MCP server and CLI for managing git worktrees.

Create isolated workspaces without the hassle of stashing changes and switching branches.

Ideal for AI-assisted development workflows requiring multiple features in parallel.

As a backup, use the `gwtree` command to run any of the mcp tools yourself.

## Available MCP Tools (9)

- `list` - List projects and their worktrees
- `new` - Create a new worktree with a matching branch
- `archive` - Archive worktrees and branches
- `go` - Open worktree folder in your editor
- `changes` - Review changes and optionally commit and push
- `grab` - Pull in changes from a specific worktree
- `pr` - Generate a link to create a pull/merge request
- `doctor` - Fix worktree metadata issues
- `clean` - Archive unused worktrees

### Usage Examples

Once the MCP server is added, here's how you might phrase requests to activate each tool:

- **List worktrees**: "List worktrees", "Show me all my projects and worktrees", "What worktrees do I have?"
- **Create new worktree**: "New worktree for fixing the login bug", "Set up a new workspace for the user dashboard feature", "Make a worktree for the API refactor"
- **Archive worktree**: "Archive this worktree", "Clean up the completed feature worktree", "Remove the old worktree and its branch"
- **Open worktree**: "Open the login bug worktree in my editor", "Switch to the dashboard worktree", "Go to the API refactor workspace"
- **Review/Push changes**: "Show changes from task-245", "What files have I modified?", "Push changes for task-245"
- **Grab changes**: "Get login bug worktree changes", "Merge updates from the dashboard branch", "Pull in changes from the API worktree"
- **Create PR**: "Generate a pull request link", "Create a merge request for task-245", "Make a PR for the current changes"
- **Fix issues**: "Fix my worktree metadata", "Repair worktree configuration", "Doctor the worktree setup"
- **Clean up**: "Clean unused worktrees", "Archive old worktrees", "Remove completed worktrees"

## Get Started

Add the MCP Server to Cursor / Claude Desktop:

```json
{
  "mcpServers": {
    "git-worktree-toolbox": {
      "command": "npx",
      "args": ["-y", "git-worktree-toolbox@latest"]
    }
  }
}
```

The `gwtree` CLI is also available after a global installation:

```bash
npm install -g git-worktree-toolbox
```

Run `gwtree help` to see the available tools and their flags.

<details>
<summary>CLI commands</summary>

```bash
# List all projects with worktrees
gwtree list

# Create a new worktree with a matching branch
gwtree new "Fix login bug and flow"

# Archive current worktree (with branch removal)
gwtree archive -r

# Open current worktree and branch in editor
gwtree go

# Show the changes from all associated worktrees
gwtree changes

# Pull in changes from a specific worktree
gwtree grab fix-login-bug-1242

# Commit and push changes in a specific worktree
gwtree changes fix-login-bug-1242 -c

# Generate a link to create a pull/merge request
gwtree pr

# Fix worktree metadata issues
gwtree doctor

# Archive unused worktrees
gwtree clean

# Show help with advanced flag usage examples
gwtree help
```

</details>

### Configuration

Configure the worktrees folder and project directories using environment variables (optional):

```bash
# Storage directory for worktrees
# Default: ~/.gwtree/worktrees
export BASE_WORKTREES_PATH=~/my-custom-worktrees

# Custom project directories for discovery (colon-separated)
# Default: ~/Projects, ~/Code, ~/Developer
export PROJECT_DIRECTORIES="$HOME/custom-projects:$HOME/work"
```

Add these to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) to persist across sessions.
