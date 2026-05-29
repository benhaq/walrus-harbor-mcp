# harbor-mcp

**ggdrive-style decentralized storage for Claude**, powered by [Walrus Harbor](https://testnet.harbor.walrus.xyz/).

This MCP server lets Claude manage files in your private, Seal-encrypted Walrus buckets with the same natural language experience you’d expect from Google Drive — but fully decentralized and end-to-end encrypted.

## Paste it to your agent and let it set it up for you

Using a coding agent like **Claude Code**, **Codex**, **Cursor**, or **Gemini CLI**? Copy the block below verbatim into the agent and it will install, configure, and verify `walrus-harbor-mcp` for you. (Have your two Harbor keys ready — see [Get your Harbor credentials](#1-get-your-harbor-credentials).)

````text
Set up the walrus-harbor-mcp MCP server for me by running these steps in order. Just run the commands — do NOT read or analyze the repo's files first. Stop and ask me only if a step actually fails.

1. Clone and enter the repo: `git clone https://github.com/benhaq/walrus-harbor-mcp.git && cd walrus-harbor-mcp`
2. Install dependencies: `pnpm install` (use `npm install` if pnpm isn't installed).
3. Create the env file: `cp .env.example .env`. Then ask me for my HARBOR_API_KEY (starts with `hbr_`) and HARBOR_SERVICE_PRIVATE_KEY (starts with `suiprivkey1`) and write them into `.env`. Don't print my keys back to me.
4. Make the launcher executable: `chmod +x bin/*.sh`.
5. Verify it works: `./bin/verify-mcp.sh`. Success = the output contains `"serverInfo":{"name":"harbor-mcp"}`.
6. Register the server using its ABSOLUTE path — this matters. The repo intentionally ships **no** MCP config, because a relative path breaks the moment the repo is cloned as a subfolder of another project (it resolves against the wrong directory and fails with ENOENT). Register the absolute path instead, from inside the repo:
   - If I'm using **Claude Code**: run `claude mcp add --scope user walrus-harbor-mcp -- "$(pwd)/bin/harbor-mcp.sh"`. (`--scope user` makes it available in every project, independent of which folder I open.)
   - If I'm using **Codex**: run `codex mcp add walrus-harbor-mcp -- "$(pwd)/bin/harbor-mcp.sh"`.
   - For **Cursor / Gemini CLI / Claude Desktop**: print the absolute path with `echo "$(pwd)/bin/harbor-mcp.sh"`, then add a stdio MCP server named `walrus-harbor-mcp` whose `command` is exactly that path in that tool's MCP config. Do NOT use a relative path.
7. Then tell me: restart the agent (or run `/mcp`), approve walrus-harbor-mcp when prompted, and test with the `ping_harbor` tool.

Don't read other files, don't commit anything, and never put my keys anywhere except `.env` (the launcher loads them from there automatically).
````

That's it — once the agent finishes and you've approved the MCP server, you can talk to your Walrus storage in natural language. The rest of this README explains each step in detail if you'd rather do it manually.

## Features

- Create private Seal-encrypted buckets
- Upload local files (automatically encrypted client-side)
- Download & decrypt files to your machine
- List spaces, buckets, and files
- Full retry + polling logic for reliable uploads
- All cryptographic operations (Seal + Sui signing) happen **locally** on your machine

## Quick Start

### 1. Get your Harbor credentials

1. Go to https://testnet.harbor.walrus.xyz/
2. Sign in with Google
3. Go to **Settings → API Keys → New API key**
4. Choose **read_write** and tick **"Create"**
5. Copy both values shown **once**:
   - `hbr_...` → `HARBOR_API_KEY`
   - `suiprivkey1...` → `HARBOR_SERVICE_PRIVATE_KEY`

### 2. Configure the server

```bash
cd harbor-mcp
cp .env.example .env
# Edit .env and paste your two keys
```

Or set environment variables directly.

### 3. Run with Claude Code / Desktop

Add as a local stdio MCP server:

```json
{
  "mcpServers": {
    "walrus-harbor-mcp": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/harbor-mcp/bin/harbor-mcp.ts"],
      "env": {
        "HARBOR_API_KEY": "hbr_...",
        "HARBOR_SERVICE_PRIVATE_KEY": "suiprivkey1..."
      }
    }
  }
}
```

Or run directly for development:

```bash
pnpm install
HARBOR_API_KEY=... HARBOR_SERVICE_PRIVATE_KEY=... pnpm exec tsx bin/harbor-mcp.ts
```

## Available Tools

| Tool              | Description                              | Read/Write |
|-------------------|------------------------------------------|------------|
| `ping_harbor`     | Check that your keys are configured      | Read       |
| `list_spaces`     | List your Personal + Team spaces         | Read       |
| `list_buckets`    | List buckets in a space                  | Read       |
| `list_files`      | List files in a bucket (with search)     | Read       |
| `create_bucket`   | Create a new private encrypted bucket    | Write      |
| `upload_file`     | Encrypt + upload a local file            | Write      |
| `download_file`   | Download + decrypt a file to disk        | Read       |
| `get_file_status` | Check upload progress                    | Read       |

## Example Prompts for Claude

- "Create a private bucket called 'agent-scratch' in my Personal Space"
- "Upload ~/Documents/Q3-report.pdf to the finance bucket"
- "List all files in my 'client-deliverables' bucket modified this month"
- "Download the latest PDF from the legal bucket and save it to ~/Downloads"
- "Show me the upload status of the file I just uploaded"

## Adding to Claude Code

The repo intentionally ships **no** MCP config file. A committed config can only hold a *relative* command (`./bin/harbor-mcp.sh`), and that silently breaks the moment the repo is cloned as a subfolder of another project: Claude Code resolves a relative `command` against the directory it was launched from — not against the subfolder — so it looks in the wrong place and fails with `ENOENT`. Instead, each clone registers its own **absolute** path once. It's one command and works no matter where you cloned the repo or which folder you open Claude Code in.

### Setup

From a fresh clone on any machine:

1. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/benhaq/walrus-harbor-mcp.git
   cd walrus-harbor-mcp
   pnpm install
   ```

2. **Add your keys** (copy the template and paste your two Harbor keys):

   ```bash
   cp .env.example .env
   # then edit .env — see "Get your Harbor credentials" above
   ```

   `.env` is git-ignored, so each machine/user supplies its own keys. The launcher scripts load it automatically.

3. **Verify the server boots** (the scripts are committed with the executable bit set, so no `chmod` is normally needed — run it if you hit a "permission denied"):

   ```bash
   ./bin/verify-mcp.sh
   # if needed: chmod +x bin/*.sh && ./bin/verify-mcp.sh
   ```

4. **Register the server with its absolute path** (run from inside the repo so `$(pwd)` is correct):

   ```bash
   claude mcp add --scope user walrus-harbor-mcp -- "$(pwd)/bin/harbor-mcp.sh"
   ```

   `--scope user` makes it available in every project, independent of which folder you open. Use `--scope local` if you'd rather scope it to the current project only. The launcher self-locates and loads `.env`, so no paths or keys go into the command.

5. Restart Claude Code (or reload the window if using it inside VS Code / Cursor), then run `/mcp`. You should see `walrus-harbor-mcp` listed — **approve it** when prompted.

6. Try these commands:

   - `ping_harbor`
   - `list_spaces`
   - `create_bucket` (with a space ID)

**About file paths in `upload_file` / `download_file`:** you don't have to live inside this repo to use them. Relative paths (and `~`) are resolved against **your current workspace**, not the harbor-mcp repo — so "upload `report.pdf`" and "download to `~/Downloads/x.pdf`" do what you'd expect from whatever project you're working in. Paths are still sandboxed to the filesystem roots your MCP client advertises (see [Security Model](#security-model)).

### Other agents / manual config

`claude mcp add` is Claude Code–specific, but the rule is the same for every agent: register a stdio MCP server named `walrus-harbor-mcp` whose `command` is the **absolute path to your own clone** — never a relative path. Print the exact value with `echo "$(pwd)/bin/harbor-mcp.sh"` from the repo root.

**Codex** ships an equivalent command — run it from inside the repo:

```bash
codex mcp add walrus-harbor-mcp -- "$(pwd)/bin/harbor-mcp.sh"
```

**Cursor, Gemini CLI, Claude Desktop, or any hand-written config:** add the server with that absolute `command`. For example, in a Claude config file (usually `~/.claude.json`, `~/.claude/config.json`, or `~/.config/claude/config.json`):

```json
{
  "mcpServers": {
    "walrus-harbor-mcp": {
      "command": "/absolute/path/to/your/harbor-mcp/bin/harbor-mcp.sh",
      "description": "Walrus Harbor decentralized storage"
    }
  }
}
```

> A global config **must** use an absolute path (it has no project root to resolve against). Set it to wherever you cloned the repo on that machine — e.g. run `echo "$(pwd)/bin/harbor-mcp.sh"` from the repo root to get the exact value.

## Security Model

- Your `HARBOR_SERVICE_PRIVATE_KEY` **never leaves your machine**.
- All Seal encryption/decryption and Sui transaction signing happens locally.
- The server only talks to the Harbor API using your `hbr_` key.
- **Path sandboxing via MCP roots.** `upload_file` (`localPath`) and `download_file` (`destPath`) are confined to the filesystem roots your MCP client advertises. Relative paths (and a leading `~`) are resolved against your **workspace root** — the first root the client advertises — not the server's own directory, so they follow wherever you're working. If the client declares roots, a path that resolves outside every root is rejected; if the client doesn't support roots, the path is allowed and a notice is logged to stderr (enforce-when-present, fail-open-when-absent).

This is why this MCP is designed as a **local stdio / MCPB** server rather than a remote one.

## MCPB bundle (one-file distribution)

The server can be packaged as a single `.mcpb` file for drag-and-drop install into Claude Desktop. The bundle inlines all dependencies (Seal/Sui are pure JS, no WASM), so it runs standalone with `node` — no `node_modules` needed.

```bash
pnpm mcpb:validate   # validate manifest.json against the v0.3 schema
pnpm mcpb:pack       # build the self-contained bundle, then pack -> walrus-harbor-mcp.mcpb
```

On install, the client prompts for the `HARBOR_API_KEY` (required), `HARBOR_SERVICE_PRIVATE_KEY` (optional, sensitive), and an optional `HARBOR_API_BASE_URL` override, wired in via `user_config` in `manifest.json`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm dev          # runs the server with tsx
```

## Roadmap / Future Work

- Team space member management tools
- Mainnet support when Harbor launches it

## License

MIT

## Acknowledgments

Built on top of [Walrus Harbor](https://github.com/MystenLabs/harbor), [Walrus](https://walrus.xyz), and [Seal](https://github.com/MystenLabs/seal) by Mysten Labs.
