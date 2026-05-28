import { Config, Context, Layer } from "effect";

/**
 * Harbor MCP configuration loaded from env + optional file (XDG).
 * All secrets are redacted (never appear in logs/spans).
 * Matches harbor/api Config patterns + Effect best practices.
 *
 * We expose both the raw Config *and* a Context.Tag so services can `yield* HarborConfig`.
 */

export const HarborConfig = Config.all({
  apiKey: Config.redacted("HARBOR_API_KEY"),
  servicePrivateKey: Config.redacted("HARBOR_SERVICE_PRIVATE_KEY").pipe(
    Config.withDefault(""), // optional for pure-metadata tools
  ),
  baseUrl: Config.string("HARBOR_API_BASE_URL").pipe(
    Config.withDefault("https://api.testnet.harbor.walrus.xyz"),
  ),
});

export type HarborConfig = Config.Config.Success<typeof HarborConfig>;

export class HarborConfigTag extends Context.Tag("HarborConfig")<HarborConfigTag, HarborConfig>() {}

export const HarborConfigLive = Layer.effect(
  HarborConfigTag,
  HarborConfig.pipe(Config.map((cfg) => cfg as HarborConfig)),
);

import { Redacted } from "effect";

// Raw (sensitive) value helpers — only call inside redacted scopes or when building headers/keys
export const getRawApiKey = (cfg: HarborConfig): string => Redacted.value(cfg.apiKey);
export const getRawServiceKey = (cfg: HarborConfig): string =>
  typeof cfg.servicePrivateKey === "string"
    ? cfg.servicePrivateKey
    : Redacted.value(cfg.servicePrivateKey as Redacted.Redacted<string>);
