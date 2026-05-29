# harbor-mcp

**ggdrive-style decentralized storage for Claude**, powered by [Walrus Harbor](https://testnet.harbor.walrus.xyz/).

This MCP server lets Claude manage files in your private, Seal-encrypted Walrus buckets with the same natural language experience you’d expect from Google Drive — but fully decentralized and end-to-end encrypted.

## Paste it to your agent and let it set it up for you

Using a coding agent like **Claude Code**, **Codex**, **Cursor**, or **Gemini CLI**? Copy the block below verbatim into the agent and it will install, configure, and verify `walrus-harbor-mcp` for you. (Have your two Harbor keys ready — see [Get your Harbor credentials](#1-get-your-harbor-credentials).)

````text
Set up the walrus-harbor-mcp server in this repository for me. Do the following, in order, and stop to ask me if any step fails:

1. Make sure we're in the harbor-mcp repo root (it contains package.json, bin/harbor-mcp.ts, and .mcp.json). If we're not already inside it, clone it from https://github.com/benhaq/walrus-harbor-mcp (`git clone https://github.com/benhaq/walrus-harbor-mcp.git`) and `cd` into the cloned folder.
2. Run `pnpm install` (fall back to `npm install` if pnpm isn't available).
3. If `.env` doesn't exist, run `cp .env.example .env`. Then ask me to paste my HARBOR_API_KEY (starts with `hbr_`) and HARBOR_SERVICE_PRIVATE_KEY (starts with `suiprivkey1`), and write them into `.env`. Never print my keys back to me or commit `.env` — it is git-ignored.
4. Ensure the launcher scripts are executable: `chmod +x bin/*.sh`.
5. Confirm `.mcp.json` registers the server with the relative command `./bin/harbor-mcp.sh` (project-scoped, portable). If it's missing, create it.
6. Run `./bin/verify-mcp.sh` and show me the output. A healthy run prints a JSON `initialize` result with `"serverInfo":{"name":"harbor-mcp"}`.
7. Tell me to restart my agent / run `/mcp`, approve the project MCP server when prompted, then test with the `ping_harbor` and `list_spaces` tools.

Do NOT paste my private key anywhere except `.env`, and do NOT commit any secrets.
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

Claude Code (the agentic coding interface) supports project-scoped MCP servers, which is the cleanest way to use `harbor-mcp`. The setup below is **portable** — it works on any machine that clones the repo, with no machine-specific paths to edit.

### Recommended Setup (Project-scoped, portable)

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

4. Restart Claude Code (or reload the window if using it inside VS Code / Cursor).

5. In Claude Code, run `/mcp`. You should see `walrus-harbor-mcp` listed. The first time, Claude Code asks you to **approve the project MCP server** — accept the trust prompt.

6. Try these commands:

   - `ping_harbor`
   - `list_spaces`
   - `create_bucket` (with a space ID)

**How it stays portable:** the project ships `.mcp.json` (the project-scoped config Claude Code reads) with a **relative** command `./bin/harbor-mcp.sh`, resolved from the repo root. The launcher itself finds its own location, so the repo works wherever you clone it. A matching `.claude/config.json` (also relative) is included for older Claude Code versions. **No absolute paths are baked in.**

### Manual / Global Config (alternative)

If you prefer a global config instead of the project-scoped one, add this to your Claude Code config file (usually `~/.claude/config.json` or `~/.config/claude/config.json`), replacing the path with the **absolute path to your own clone**:

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
- **Path sandboxing via MCP roots.** `upload_file` (`localPath`) and `download_file` (`destPath`) are confined to the filesystem roots your MCP client advertises. If the client declares roots, a path outside every root is rejected; if the client doesn't support roots, the path is allowed and a notice is logged to stderr (enforce-when-present, fail-open-when-absent).

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
