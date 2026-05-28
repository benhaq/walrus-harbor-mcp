import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import {
  FileStatusError,
  HarborApiError,
  LocalFsError,
  MirrorGrantMissingError,
} from "./errors.js";
import type { FileStatusResponse, FileUploadResponse } from "./HarborApiClient.js";
import { HarborApiClient } from "./HarborApiClient.js";
import { SealCryptoService } from "./SealCryptoService.js";
import type { BucketId, FileId, SpaceId } from "./types.js";

/**
 * High-level "ggdrive" style operations.
 * Combines HarborApiClient + SealCryptoService into user-friendly flows.
 *
 * All heavy crypto + signing + retry logic lives here.
 */

export class HarborStorageService extends Effect.Service<HarborStorageService>()(
  "HarborStorageService",
  {
    effect: Effect.gen(function* () {
      const api = yield* HarborApiClient;
      const seal = yield* SealCryptoService;

      /**
       * Full create bucket flow (private + Seal).
       * Returns the final active bucket.
       */
      const createBucket = Effect.fn("HarborStorageService.createBucket")(function* (
        spaceId: SpaceId,
        name: string,
      ) {
        // 1. Reserve
        const reserve = yield* api.createBucket(spaceId, name);

        // 2. Sign locally
        const signature = yield* seal.signTransactionBytes(reserve.bytes);

        // 3. Finalize
        const finalized = yield* api.finalizeBucket(reserve.bucket_id, signature);

        return {
          bucketId: finalized.bucket_id,
          sealPolicyId: finalized.seal_policy_id,
          state: finalized.state,
        };
      });

      /**
       * Upload a local file: read, encrypt with Seal, upload with retry + polling.
       * Caller provides sealPolicyId (returned from createBucket).
       */
      const uploadFileToBucket = Effect.fn("HarborStorageService.uploadFileToBucket")(function* (
        bucketId: BucketId,
        sealPolicyId: string,
        localPath: string,
        targetName?: string,
      ) {
        const fileBytes = yield* Effect.tryPromise({
          try: () => fs.readFile(localPath),
          catch: () =>
            new LocalFsError({
              message: "Failed to read local file",
              path: localPath,
              operation: "read",
            }),
        }).pipe(Effect.map((b) => new Uint8Array(b)));

        const fileName = targetName ?? path.basename(localPath);

        // Encrypt
        const encrypted = yield* seal.encrypt(fileBytes, sealPolicyId);

        // Upload with simple retry loop on mirror_missing_grant (pragmatic & type-safe)
        let uploadResult: FileUploadResponse | undefined;
        let lastErr: HarborApiError | undefined;
        for (let attempt = 0; attempt < 12; attempt++) {
          const res = yield* api
            .uploadBucketFile(bucketId, encrypted, fileName)
            .pipe(Effect.either);

          if (res._tag === "Right") {
            uploadResult = res.right;
            break;
          }

          lastErr = res.left;
          if (lastErr instanceof HarborApiError && lastErr.code === "mirror_missing_grant") {
            yield* Effect.sleep("3 seconds");
            continue;
          }
          return yield* Effect.fail(lastErr);
        }

        if (!uploadResult) {
          return yield* Effect.fail(new MirrorGrantMissingError({ bucketId, attempt: 12 }));
        }

        const fileId = uploadResult.data.id;

        // Poll until completed or failed (simple loop)
        let finalStatus: FileStatusResponse | undefined;
        let lastState = "queued";
        for (let i = 0; i < 40; i++) {
          const status = yield* api.getFileUploadStatus(bucketId, fileId);
          lastState = status.data.state;
          if (status.data.state === "completed") {
            finalStatus = status;
            break;
          }
          if (status.data.state === "failed") {
            return yield* Effect.fail(
              new FileStatusError({
                fileId,
                state: status.data.state,
                error: status.data.error ?? { code: "unknown", message: "Upload failed" },
              }),
            );
          }
          yield* Effect.sleep("2 seconds");
        }

        if (!finalStatus) {
          return yield* Effect.fail(
            new FileStatusError({
              fileId,
              state: lastState,
              error: { code: "timeout", message: "Upload did not complete in time" },
            }),
          );
        }

        return { fileId, name: fileName };
      });

      /**
       * Download + decrypt to a local path.
       */
      const downloadFile = Effect.fn("HarborStorageService.downloadFile")(function* (
        bucketId: BucketId,
        fileId: FileId,
        sealPolicyId: string,
        destPath: string,
      ) {
        const ciphertext = yield* api.downloadBucketFile(bucketId, fileId);

        const plaintext = yield* seal.decrypt(ciphertext, sealPolicyId);

        yield* Effect.tryPromise({
          try: () => fs.writeFile(destPath, plaintext),
          catch: () =>
            new LocalFsError({
              message: "Failed to write downloaded file",
              path: destPath,
              operation: "write",
            }),
        });

        return { bytesWritten: plaintext.length, destPath };
      });

      return {
        createBucket,
        uploadFileToBucket,
        downloadFile,
      } as const;
    }),

    dependencies: [HarborApiClient.Default, SealCryptoService.Default],
  },
) {}
