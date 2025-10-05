# 🌳 Git Worktree Toolbox MCP Server (includes CLI)

Gives AI agents the power to spin up isolated git worktrees on demand. Work on multiple features in parallel, each with its own branch and workspace, without the branch-switching chaos.

Each task runs in its own sandbox—experiment, break things, pivot strategies—while your main branch stays pristine. Built for AI-assisted workflows where rapid iteration and context switching are the norm.

### Available Tools

**Discovery & Navigation**

- `list projects` - Discover git repositories in configured directories
- `list workspaces` - View all workspaces for a repository
- `get workspace info` - Get detailed workspace information

**Workspace Lifecycle**

- `create workspace` - Create isolated worktree for a task
- `initialize workspace metadata` - Initialize metadata for existing workspace
- `archive workspace` - Archive completed workspace
- `launch workspace` - Open workspace in IDE/terminal

**Change Management**

- `list changes from specific workspace` - Show detailed changes in a workspace
- `force commit workspace` - Manually trigger commit in workspace
- `merge workspace changes` - Sync remote changes to local workspace

**Integration**

- `generate mr link` - Generate GitLab/GitHub merge request link

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

## Architecture

- **STDIO Transport**: Native stdin/stdout communication for MCP clients
- **MCP SDK**: Model Context Protocol implementation
- **Git Worktrees**: Isolated development environments
- **YAML Metadata**: Distributed workspace configuration

### Why use a STDIO transport?

**STDIO** (stdin/stdout) was chosen over HTTP/SSE and WebSocket transports for several key reasons:

**Security** - Process-level isolation. No exposed ports, no authentication layers, no CORS concerns. Communication stays within the local machine.

**Simplicity** - Zero infrastructure required. No web servers, proxies, or network configuration. Just a command that spawns a process.

**Native MCP Support** - Claude Desktop and Cursor natively support STDIO transport out-of-the-box. No additional tooling or adapters needed.
