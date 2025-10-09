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

The `gwtree` command can be used after a global installation:

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

Configure the worktrees folder and project directories (optional):

```env
# Storage directory for worktrees and metadata files
# Default: ~/.gwtree/worktrees
BASE_WORKTREES_PATH=~/my-custom-worktrees

# Custom project directories for discovery (colon-separated)
PROJECT_DIRECTORIES="$HOME/custom-projects:$HOME/work"
```
