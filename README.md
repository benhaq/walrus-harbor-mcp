# harbor-mcp

**ggdrive-style decentralized storage for Claude**, powered by [Walrus Harbor](https://testnet.harbor.walrus.xyz/).

This MCP server lets Claude manage files in your private, Seal-encrypted Walrus buckets with the same natural language experience you’d expect from Google Drive — but fully decentralized and end-to-end encrypted.

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
    "harbor": {
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

Claude Code (the agentic coding interface) supports project-scoped MCP servers, which is the cleanest way to use `harbor-mcp`.

### Recommended Setup (Project-scoped)

1. Make sure you have your keys in `.env` (copy from `.env.example`).

2. Run the verification script:

   ```bash
   ./bin/verify-mcp.sh
   ```

3. Restart Claude Code (or reload the window if using it inside VS Code / Cursor).

4. In Claude Code, run:

   ```bash
   /mcp
   ```

   You should see `harbor` listed.

5. Try these commands:

   - `ping_harbor`
   - `list_spaces`
   - `create_bucket` (with a space ID)

The project already includes `.claude/config.json` that points to a robust launcher script (`bin/harbor-mcp.sh`). This is the recommended configuration.

### Manual / Global Config (alternative)

If you prefer a global config, add this to your Claude Code config file (usually `~/.claude/config.json` or `~/.config/claude/config.json`):

```json
{
  "mcpServers": {
    "harbor": {
      "command": "/Users/s6klabs/Documents/dev/commandoss/harbor-mcp/bin/harbor-mcp.sh",
      "description": "Walrus Harbor decentralized storage"
    }
  }
}
```

## Security Model

- Your `HARBOR_SERVICE_PRIVATE_KEY` **never leaves your machine**.
- All Seal encryption/decryption and Sui transaction signing happens locally.
- The server only talks to the Harbor API using your `hbr_` key.

This is why this MCP is designed as a **local stdio / MCPB** server rather than a remote one.

## Development

```bash
pnpm install
pnpm typecheck
pnpm dev          # runs the server with tsx
```

## Roadmap / Future Work

- Full `delete_file` + `delete_bucket`
- Team space member management tools
- MCPB bundle for one-file distribution
- Better local path sandboxing using MCP `roots`
- Mainnet support when Harbor launches it

## License

MIT

## Acknowledgments

Built on top of [Walrus Harbor](https://github.com/MystenLabs/harbor), [Walrus](https://walrus.xyz), and [Seal](https://github.com/MystenLabs/seal) by Mysten Labs.
