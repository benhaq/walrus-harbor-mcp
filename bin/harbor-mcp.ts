#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Redacted } from "effect";
import { z } from "zod";
import { getRawServiceKey, HarborConfigTag } from "../src/config.js";
import { HarborApiClient } from "../src/harbor/HarborApiClient.js";
import { HarborStorageService } from "../src/harbor/HarborStorageService.js";
import { BucketId, FileId, SpaceId } from "../src/harbor/types.js";
import { assertPathWithinRoots } from "../src/pathSandbox.js";
import { AppRuntime, runPromise } from "../src/runtime.js";

/**
 * Harbor MCP Server — stdio entrypoint.
 * Claude Code / Desktop launches this process.
 * All heavy logic lives in Effect services behind the runtime.
 */

const server = new McpServer(
  {
    name: "harbor-mcp",
    version: "0.1.0",
  },
  {
    instructions:
      "Harbor is ggdrive-style decentralized storage (Walrus + Seal encryption). " +
      "Use list_spaces / list_buckets / search_files before mutating. " +
      "Uploads and downloads require the user's local service private key (never sent to remote).",
  },
);

// Simple diagnostic tool (works even with partial config)
server.registerTool(
  "ping_harbor",
  {
    title: "Ping Harbor Config",
    description:
      "Returns whether the required HARBOR_API_KEY (and optional service key) are present in the environment. Safe to call first.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async () => {
    const result = await runPromise(
      Effect.gen(function* () {
        const cfg = yield* HarborConfigTag;
        const apiKeyVal = Redacted.value(cfg.apiKey);
        const hasKey = !!apiKeyVal && apiKeyVal.length > 8;
        const hasSvc = !!getRawServiceKey(cfg);
        return {
          ok: hasKey,
          has_api_key: hasKey,
          has_service_key: hasSvc,
          base_url: cfg.baseUrl,
          hint: hasKey
            ? "Ready for Harbor API calls"
            : "Set HARBOR_API_KEY (and optionally HARBOR_SERVICE_PRIVATE_KEY) in your environment or ~/.config/harbor-mcp/config.json",
        };
      }),
    );

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

/**
 * Safe wrapper for all tool handlers.
 * This ensures that any error (including Effect failures, missing keys, API errors, etc.)
 * is turned into a readable message instead of a silent "Result" in Claude Desktop.
 */
function safeTool<Args, T>(toolName: string, handler: (args: Args) => Promise<T>) {
  return async (args: Args) => {
    try {
      const result = await handler(args);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error && error.stack ? `\n\n${error.stack}` : "";

      console.error(`[harbor-mcp ERROR] Tool "${toolName}" failed:`);
      console.error(error);

      return {
        content: [
          {
            type: "text" as const,
            text: `**Error in ${toolName}**\n\n${message}${stack}`,
          },
        ],
      };
    }
  };
}

// ======================
// Core ggdrive-style tools
// ======================

server.registerTool(
  "list_spaces",
  {
    title: "List Spaces",
    description: "List your Personal and Team spaces in Harbor.",
    inputSchema: { type: z.enum(["personal", "team"]).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  safeTool("list_spaces", async ({ type }: { type?: "personal" | "team" | undefined }) => {
    return await runPromise(
      Effect.gen(function* () {
        const api = yield* HarborApiClient;
        return yield* api.listSpaces({ type });
      }),
    );
  }),
);

server.registerTool(
  "list_buckets",
  {
    title: "List Buckets",
    description: "List buckets in a space.",
    inputSchema: {
      spaceId: z.string(),
      limit: z.number().optional(),
      q: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  safeTool(
    "list_buckets",
    async ({
      spaceId,
      limit,
      q,
    }: {
      spaceId: string;
      limit?: number | undefined;
      q?: string | undefined;
    }) => {
      return await runPromise(
        Effect.gen(function* () {
          const api = yield* HarborApiClient;
          return yield* api.listBuckets({ spaceId: SpaceId.make(spaceId), limit, q });
        }),
      );
    },
  ),
);

server.registerTool(
  "create_bucket",
  {
    title: "Create Private Encrypted Bucket",
    description: "Creates a new Seal-encrypted bucket. Returns sealPolicyId (save it!).",
    inputSchema: {
      spaceId: z.string(),
      name: z.string().min(1).max(100),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  safeTool("create_bucket", async ({ spaceId, name }: { spaceId: string; name: string }) => {
    return await runPromise(
      Effect.gen(function* () {
        const storage = yield* HarborStorageService;
        return yield* storage.createBucket(SpaceId.make(spaceId), name);
      }),
    );
  }),
);

server.registerTool(
  "upload_file",
  {
    title: "Upload & Encrypt File",
    description: "Reads a local file, encrypts it with Seal, and uploads it.",
    inputSchema: {
      bucketId: z.string(),
      sealPolicyId: z.string(),
      localPath: z.string(),
      name: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  safeTool(
    "upload_file",
    async ({
      bucketId,
      sealPolicyId,
      localPath,
      name,
    }: {
      bucketId: string;
      sealPolicyId: string;
      localPath: string;
      name?: string | undefined;
    }) => {
      await assertPathWithinRoots(server.server, localPath, "Source");
      return await runPromise(
        Effect.gen(function* () {
          const storage = yield* HarborStorageService;
          return yield* storage.uploadFileToBucket(
            BucketId.make(bucketId),
            sealPolicyId,
            localPath,
            name,
          );
        }),
      );
    },
  ),
);

server.registerTool(
  "download_file",
  {
    title: "Download & Decrypt File",
    description: "Downloads a file, decrypts it, and saves it to the path you specify.",
    inputSchema: {
      bucketId: z.string(),
      fileId: z.string(),
      sealPolicyId: z.string(),
      destPath: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  safeTool(
    "download_file",
    async ({
      bucketId,
      fileId,
      sealPolicyId,
      destPath,
    }: {
      bucketId: string;
      fileId: string;
      sealPolicyId: string;
      destPath: string;
    }) => {
      await assertPathWithinRoots(server.server, destPath, "Destination");
      return await runPromise(
        Effect.gen(function* () {
          const storage = yield* HarborStorageService;
          return yield* storage.downloadFile(
            BucketId.make(bucketId),
            FileId.make(fileId),
            sealPolicyId,
            destPath,
          );
        }),
      );
    },
  ),
);

server.registerTool(
  "list_files",
  {
    title: "List Files in Bucket",
    description: "List files inside a specific bucket (supports search).",
    inputSchema: {
      bucketId: z.string(),
      limit: z.number().optional(),
      q: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  safeTool(
    "list_files",
    async ({
      bucketId,
      limit,
      q,
    }: {
      bucketId: string;
      limit?: number | undefined;
      q?: string | undefined;
    }) => {
      return await runPromise(
        Effect.gen(function* () {
          const api = yield* HarborApiClient;
          return yield* api.listBucketFiles(BucketId.make(bucketId), limit, undefined, q);
        }),
      );
    },
  ),
);

server.registerTool(
  "get_file_status",
  {
    title: "Get File Upload Status",
    description:
      "Check the processing state of an in-flight upload (queued / active / completed / failed).",
    inputSchema: {
      bucketId: z.string(),
      fileId: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  safeTool(
    "get_file_status",
    async ({ bucketId, fileId }: { bucketId: string; fileId: string }) => {
      return await runPromise(
        Effect.gen(function* () {
          const api = yield* HarborApiClient;
          return yield* api.getFileUploadStatus(BucketId.make(bucketId), FileId.make(fileId));
        }),
      );
    },
  ),
);

server.registerTool(
  "get_bucket",
  {
    title: "Get Bucket by ID",
    description: "Fetch a single bucket's metadata (name, visibility, sealPolicyId, storage used).",
    inputSchema: {
      bucketId: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  safeTool("get_bucket", async ({ bucketId }: { bucketId: string }) => {
    return await runPromise(
      Effect.gen(function* () {
        const api = yield* HarborApiClient;
        return yield* api.getBucketById(BucketId.make(bucketId));
      }),
    );
  }),
);

server.registerTool(
  "rename_bucket",
  {
    title: "Rename Bucket",
    description:
      "Renames a bucket. Preserves the bucket's visibility and Seal policy. " +
      "Does NOT rename files (Harbor has no file-rename API).",
    inputSchema: {
      bucketId: z.string(),
      name: z.string().min(1).max(100),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  safeTool("rename_bucket", async ({ bucketId, name }: { bucketId: string; name: string }) => {
    return await runPromise(
      Effect.gen(function* () {
        const api = yield* HarborApiClient;
        return yield* api.renameBucket(BucketId.make(bucketId), name);
      }),
    );
  }),
);

server.registerTool(
  "delete_bucket",
  {
    title: "Delete Bucket",
    description:
      "Permanently deletes a bucket and all of its files. Irreversible. " +
      "Confirm with the user and list_files first.",
    inputSchema: {
      bucketId: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  safeTool("delete_bucket", async ({ bucketId }: { bucketId: string }) => {
    return await runPromise(
      Effect.gen(function* () {
        const api = yield* HarborApiClient;
        return yield* api.deleteBucket(BucketId.make(bucketId));
      }),
    );
  }),
);

server.registerTool(
  "delete_file",
  {
    title: "Delete File from Bucket",
    description:
      "Permanently deletes a single file from a bucket. Irreversible. " +
      "Call list_files first to confirm the fileId. To delete an entire bucket and all its files at once, use delete_bucket instead.",
    inputSchema: {
      bucketId: z.string(),
      fileId: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  safeTool("delete_file", async ({ bucketId, fileId }: { bucketId: string; fileId: string }) => {
    return await runPromise(
      Effect.gen(function* () {
        const api = yield* HarborApiClient;
        return yield* api.deleteBucketFile(BucketId.make(bucketId), FileId.make(fileId));
      }),
    );
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = () => {
  void AppRuntime.dispose().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.error(
  "harbor-mcp ready (stdio mode) — all tool errors will now be shown clearly in Claude",
);
