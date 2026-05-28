import { Data } from "effect";

/**
 * Harbor API and Seal crypto domain errors.
 * All extend Data.TaggedError for exhaustive matching (matches harbor/api conventions).
 */

export class HarborApiError extends Data.TaggedError("HarborApiError")<{
  readonly message: string;
  readonly code?: string;
  readonly status?: number;
  readonly endpoint?: string;
}> {}

export class HarborAuthError extends Data.TaggedError("HarborAuthError")<{
  readonly message: string;
  readonly code: "missing_api_key" | "invalid_api_key" | "read_only_api_key";
}> {}

export class SealCryptoError extends Data.TaggedError("SealCryptoError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly step: "load_keypair" | "encrypt" | "decrypt" | "build_ptb" | "session_key" | "sign";
}> {}

export class MirrorGrantMissingError extends Data.TaggedError("MirrorGrantMissingError")<{
  readonly bucketId: string;
  readonly fileId?: string;
  readonly attempt: number;
}> {}

export class FileStatusError extends Data.TaggedError("FileStatusError")<{
  readonly fileId: string;
  readonly state: string;
  readonly error?: { code: string; message: string };
}> {}

export class LocalFsError extends Data.TaggedError("LocalFsError")<{
  readonly message: string;
  readonly path: string;
  readonly operation: "read" | "write" | "stat" | "validate";
}> {}
