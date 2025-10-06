# 🌳 Git Worktree Toolbox MCP Server (includes CLI)

Gives AI agents the power to spin up isolated git worktrees on demand. Work on multiple features in parallel, each with its own branch, without stash and branch-switching chaos.

Each task runs in its own sandbox—experiment, so you can break things or pivot strategies—while your main branch stays pristine. Built for AI-assisted workflows where rapid iteration and context switching are the norm.

### Available MCP Tools

**Discovery & Navigation**

- `list` - List projects and their worktrees
- `go` - Open worktree folder in your editor

**Worktree Lifecycle**

- `new` - Create a new worktree with a matching branch
- `changes` - Show changes and optionally commit and push
- `archive` - Archive worktree and matching branch
- `doctor` - Check and fix worktree metadata

**Integration**

- `mr` - Supply the MR/PR creation link
- `grab` - Merge changes from another worktree

### CLI Usage

Use the `gwtree` CLI to run tools directly:

```bash
# Create a new worktree
gwtree create -d "Fix login bug" -b login-fix

# Archive a worktree (with branch removal)
gwtree archive -i task-abc123 -r

# Open worktree in editor
gwtree go -i task-abc123 -e cursor

# Show changes and commit/push
gwtree changes -i task-abc123
# Commit/push the changes
gwtree changes -i task-abc123 -c

# Merge changes from another worktree
gwtree grab -i feature-branch -f

# Generate MR link
gwtree mr -i task-abc123

# List all projects
gwtree list

# Check worktree health
gwtree doctor

# Show help
gwtree --help

# Show version
gwtree --version
```

**Positional arguments**: The first string flag can be provided without the flag name:

```bash
gwtree create "Fix login bug"  # Same as: gwtree create -d "Fix login bug"
```

## Get Started

Two installation options for this package:

**Option 1: Use with npx (recommended)**

- No installation required
- Version auto updates

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

**Option 2: Install Globally**

- Locally installed and run
- No version auto updates

```bash
npm install -g git-worktree-toolbox
```

```json
{
  "mcpServers": {
    "git-worktree-toolbox": {
      "command": "gwtree"
    }
  }
}
```

### Configuration

Set custom project directories for the `list projects` tool (optional):

```env
# Custom project directories (colon-separated)
# Default: ~/Projects:~/Code:~/Developer:~/dev
PROJECT_DIRECTORIES=~/custom-projects:~/work:~/repos
```

## Development

Run the dev server and inspect the MCP connection:

```sh
npm run dev
npm run inspect
```

### Why use a STDIO transport?

**STDIO** (stdin/stdout) was chosen over HTTP/SSE and WebSocket transports for several key reasons:

**Security** - Process-level isolation. No exposed ports, no authentication layers, no CORS concerns. Communication stays within the local machine.

**Simplicity** - Zero infrastructure required. No web servers, proxies, or network configuration. Just a command that spawns a process.

**Native MCP Support** - Claude Desktop and Cursor natively support STDIO transport out-of-the-box. No additional tooling or adapters needed.
