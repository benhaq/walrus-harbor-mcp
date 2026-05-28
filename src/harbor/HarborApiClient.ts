import { HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from "@effect/platform";
import { Effect } from "effect";
import { getRawApiKey, HarborConfigTag } from "../config.js";
import { HarborApiError, HarborAuthError } from "./errors.js";
import type { Bucket, BucketId, FileId, FileSummary, SpaceId, SpaceListItem } from "./types.js";

// Harbor stores a file's mime_type from the multipart part's content-type (it does NOT
// sniff the ciphertext or read the extension server-side). The UI keys preview/rendering
// off that stored mime, so an octet-stream type makes images/PDFs un-previewable even
// though they decrypt fine. Derive the real type from the file name.
const EXT_MIME: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
  csv: "text/csv",
  htm: "text/html",
  html: "text/html",
  md: "text/markdown",
  mdx: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

function contentTypeFromName(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export interface CreateBucketReserveResponse {
  readonly bucket_id: BucketId;
  readonly bytes: string; // base64 sponsored tx
  readonly digest: string;
  readonly state: "pending_policy";
}

export interface FinalizeBucketResponse {
  readonly bucket_id: BucketId;
  readonly seal_policy_id: string | null;
  readonly state: string;
}

export interface FileUploadResponse {
  readonly data: {
    readonly id: FileId;
  };
}

export interface FileStatusResponse {
  readonly data: {
    readonly state: "queued" | "active" | "completed" | "failed";
    readonly progress?: number;
    readonly error?: { code: string; message: string };
  };
}

export interface FileListResponse {
  readonly data: readonly FileSummary[];
  readonly pagination: {
    readonly limit: number;
    readonly has_more: boolean;
    readonly next_cursor: string | null;
  };
}

/** Harbor wraps single-resource GETs as `{ data: <resource> }`. */
interface DataEnvelope<T> {
  readonly data: T;
}

/** Harbor error bodies arrive as `{ error: "msg" }` or `{ error: { code, message } }`. */
interface HarborErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly error?: string | { readonly code?: string; readonly message?: string };
}

/**
 * Typed Harbor REST API client as an Effect v3 Service.
 * Uses @effect/platform HttpClient (with bearer auth pre-processor).
 * Matches harbor/api service conventions (Effect.fn, annotate, TaggedError).
 *
 * Only the curated external surface (Bearer-only) is implemented.
 */

export class HarborApiClient extends Effect.Service<HarborApiClient>()("HarborApiClient", {
  effect: Effect.gen(function* () {
    const config = yield* HarborConfigTag;
    const http = yield* HttpClient.HttpClient;

    // Authenticated client: prepend the API base URL + Bearer header for every request
    const authed = http.pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(config.baseUrl)),
      HttpClient.mapRequest((req) =>
        HttpClientRequest.setHeader(req, "Authorization", `Bearer ${getRawApiKey(config)}`),
      ),
      HttpClient.mapRequest(HttpClientRequest.acceptJson),
    );

    const handleError = (res: HttpClientResponse.HttpClientResponse) =>
      Effect.gen(function* () {
        const body: HarborErrorBody = yield* res.json.pipe(
          Effect.catchAll(() => Effect.succeed({})),
          Effect.map((b) => b as HarborErrorBody),
        );
        // Harbor error bodies come as either `{ error: "msg" }` or `{ error: { code, message } }`,
        // so pull the string out of both shapes — otherwise String(message) yields "[object Object]".
        const errBody = body.error;
        const code =
          body.code ?? (errBody && typeof errBody === "object" ? errBody.code : undefined);
        const message =
          (typeof errBody === "string" ? errBody : errBody?.message) ??
          body.message ??
          `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403) {
          return yield* Effect.fail(
            new HarborAuthError({
              message: String(message),
              code: code === "read_only_api_key" ? "read_only_api_key" : "invalid_api_key",
            }),
          );
        }
        return yield* Effect.fail(
          new HarborApiError({
            message: String(message),
            ...(code !== undefined ? { code } : {}),
            status: res.status,
          }),
        );
      });

    const listSpaces = Effect.fn("HarborApiClient.listSpaces")(function* (filter?: {
      type?: "personal" | "team" | undefined;
    }) {
      const url = filter?.type ? `/api/v1/spaces?type=${filter.type}` : "/api/v1/spaces";
      const res = yield* authed.get(url);
      if (res.status !== 200) return yield* handleError(res);
      const json = (yield* res.json) as DataEnvelope<readonly SpaceListItem[]>;
      return json.data;
    });

    const listBuckets = Effect.fn("HarborApiClient.listBuckets")(function* (args: {
      spaceId: SpaceId;
      limit?: number | undefined;
      cursor?: string | undefined;
      q?: string | undefined;
      visibility?: "public" | "private" | undefined;
    }) {
      const params = new URLSearchParams();
      if (args.limit !== undefined) params.set("limit", String(args.limit));
      if (args.cursor) params.set("cursor", args.cursor);
      if (args.q) params.set("q", args.q);
      if (args.visibility) params.set("visibility", args.visibility);

      const res = yield* authed.get(`/api/v1/spaces/${args.spaceId}/buckets?${params.toString()}`);
      if (res.status !== 200) return yield* handleError(res);
      const json = (yield* res.json) as {
        buckets: readonly Bucket[];
        next_cursor: string | null;
      };
      return {
        buckets: json.buckets,
        next_cursor: json.next_cursor,
      };
    });

    // === Write flows support ===

    const createBucket = Effect.fn("HarborApiClient.createBucket")(function* (
      spaceId: SpaceId,
      name: string,
    ) {
      const res = yield* authed.post(`/api/v1/spaces/${spaceId}/buckets`, {
        body: HttpBody.text(JSON.stringify({ name, scope: "private" }), "application/json"),
      });
      if (res.status !== 201) return yield* handleError(res);
      return (yield* res.json) as CreateBucketReserveResponse;
    });

    const finalizeBucket = Effect.fn("HarborApiClient.finalizeBucket")(function* (
      bucketId: BucketId,
      signature: string,
    ) {
      const res = yield* authed.post(`/api/v1/buckets/${bucketId}/finalize`, {
        body: HttpBody.text(JSON.stringify({ signature }), "application/json"),
      });
      if (res.status !== 200) return yield* handleError(res);
      return (yield* res.json) as FinalizeBucketResponse;
    });

    const getBucketById = Effect.fn("HarborApiClient.getBucketById")(function* (
      bucketId: BucketId,
    ) {
      const res = yield* authed.get(`/api/v1/buckets/${bucketId}`);
      if (res.status !== 200) return yield* handleError(res);
      const json = (yield* res.json) as DataEnvelope<Bucket>;
      return json.data;
    });

    const updateBucket = Effect.fn("HarborApiClient.updateBucket")(function* (
      bucketId: BucketId,
      body: {
        name: string;
        visibility?: "public" | "private";
        sealPolicyId?: string | null;
      },
    ) {
      const res = yield* authed.put(`/api/v1/buckets/${bucketId}`, {
        body: HttpBody.text(JSON.stringify(body), "application/json"),
      });
      if (res.status !== 200) return yield* handleError(res);
      const json = (yield* res.json) as Bucket & { data?: Bucket };
      return json.data ?? json;
    });

    const renameBucket = Effect.fn("HarborApiClient.renameBucket")(function* (
      bucketId: BucketId,
      newName: string,
    ) {
      // PUT /buckets/{id} is a partial update. visibility (and sealPolicyId) are immutable
      // server-side — sending visibility at all returns 403 "Visibility cannot be changed
      // after creation" — so a rename sends only the name.
      return yield* updateBucket(bucketId, { name: newName });
    });

    const deleteBucket = Effect.fn("HarborApiClient.deleteBucket")(function* (bucketId: BucketId) {
      // Harbor guards bucket deletion behind ?confirm=true (it deletes all contained files).
      const res = yield* authed.del(`/api/v1/buckets/${bucketId}?confirm=true`);
      // Harbor returns 204 No Content on success.
      if (res.status !== 200 && res.status !== 204) {
        return yield* handleError(res);
      }
      return { id: bucketId, deleted: true };
    });

    const uploadBucketFile = Effect.fn("HarborApiClient.uploadBucketFile")(function* (
      bucketId: BucketId,
      fileBytes: Uint8Array,
      fileName: string,
      metadata?: Record<string, unknown>,
    ) {
      // Pragmatic multipart using native fetch (reliable for MCP use case)
      const form = new FormData();
      const blob = new Blob([fileBytes], { type: contentTypeFromName(fileName) });
      form.append("file", blob, fileName);
      if (metadata) {
        form.append("metadata", JSON.stringify(metadata));
      }

      const url = `${config.baseUrl}/api/v1/buckets/${bucketId}/files`;
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${getRawApiKey(config)}`,
            },
            body: form,
          }),
        catch: () => new HarborApiError({ message: "Multipart upload failed" }),
      });

      if (response.status !== 202) {
        const text = yield* Effect.tryPromise(() => response.text()).pipe(
          Effect.catchAll(() => Effect.succeed("")),
        );
        return yield* Effect.fail(
          new HarborApiError({
            message: `Upload failed with status ${response.status}: ${text}`,
            status: response.status,
          }),
        );
      }

      const json = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new HarborApiError({
            message: "Failed to parse upload response JSON",
            status: response.status,
          }),
      });
      return json as FileUploadResponse;
    });

    const getFileUploadStatus = Effect.fn("HarborApiClient.getFileUploadStatus")(function* (
      bucketId: BucketId,
      fileId: FileId,
    ) {
      const res = yield* authed.get(`/api/v1/buckets/${bucketId}/files/${fileId}/status`);
      if (res.status !== 200) return yield* handleError(res);
      return (yield* res.json) as FileStatusResponse;
    });

    const downloadBucketFile = Effect.fn("HarborApiClient.downloadBucketFile")(function* (
      bucketId: BucketId,
      fileId: FileId,
    ) {
      const url = `${config.baseUrl}/api/v1/buckets/${bucketId}/files/${fileId}/download`;
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${getRawApiKey(config)}`,
            },
          }),
        catch: () => new HarborApiError({ message: "Download failed" }),
      });

      if (response.status !== 200) {
        const text = yield* Effect.tryPromise(() => response.text()).pipe(
          Effect.catchAll(() => Effect.succeed("")),
        );
        return yield* Effect.fail(
          new HarborApiError({
            message: `Download failed: ${response.status} ${text}`,
            status: response.status,
          }),
        );
      }

      const arrayBuffer = yield* Effect.tryPromise(() => response.arrayBuffer());
      return new Uint8Array(arrayBuffer);
    });

    const deleteBucketFile = Effect.fn("HarborApiClient.deleteBucketFile")(function* (
      bucketId: BucketId,
      fileId: FileId,
    ) {
      const res = yield* authed.del(`/api/v1/buckets/${bucketId}/files/${fileId}`);
      // Harbor returns 204 No Content on success; tolerate 200 with a body too.
      if (res.status !== 200 && res.status !== 204) {
        return yield* handleError(res);
      }
      return { id: fileId, deleted: true };
    });

    const listBucketFiles = Effect.fn("HarborApiClient.listBucketFiles")(function* (
      bucketId: BucketId,
      limit?: number,
      cursor?: string,
      q?: string,
    ) {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      if (q) params.set("q", q);

      const res = yield* authed.get(`/api/v1/buckets/${bucketId}/files?${params.toString()}`);
      if (res.status !== 200) return yield* handleError(res);
      return (yield* res.json) as FileListResponse;
    });

    return {
      listSpaces,
      listBuckets,
      createBucket,
      finalizeBucket,
      uploadBucketFile,
      getFileUploadStatus,
      downloadBucketFile,
      listBucketFiles,
      deleteBucketFile,
      getBucketById,
      updateBucket,
      renameBucket,
      deleteBucket,
    } as const;
  }),
  // HttpClient + HarborConfigTag are provided by the AppLayer at the runtime composition point (see src/runtime.ts)
  dependencies: [],
}) {}
