import { FetchHttpClient } from "@effect/platform";
import { type Effect, Layer, ManagedRuntime } from "effect";
import { HarborConfigLive } from "./config.js";
import { HarborApiClient } from "./harbor/HarborApiClient.js";
import { HarborStorageService } from "./harbor/HarborStorageService.js";
import { SealCryptoService } from "./harbor/SealCryptoService.js";

/**
 * Single ManagedRuntime for the entire harbor-mcp server.
 * All tools run effects against this runtime.
 */

// Base layers (config + HTTP client) that every service depends on.
const BaseLayer = Layer.mergeAll(HarborConfigLive, FetchHttpClient.layer);

// Provide the base layers into every service, and re-export the base
// services too so config-only tools (e.g. ping_harbor) keep working.
export const AppLayer = Layer.mergeAll(
  HarborApiClient.Default,
  SealCryptoService.Default,
  HarborStorageService.Default,
).pipe(Layer.provideMerge(BaseLayer));

export type AppServices = Layer.Layer.Success<typeof AppLayer>;

export const AppRuntime = ManagedRuntime.make(AppLayer);

// Helper for MCP tools. The effect's requirements must be satisfied by
// AppServices — no `any` cast, so a missing layer is a compile error.
export const runPromise = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
  AppRuntime.runPromise(effect);
