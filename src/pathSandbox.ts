import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MCP "roots" path sandboxing.
 *
 * MCP clients can advertise a set of filesystem "roots" (file:// URIs) that
 * scope which directories a server is allowed to touch. Harbor's upload_file
 * (localPath) and download_file (destPath) read/write the local disk, so we
 * confine those paths to the client's declared roots when they exist.
 *
 * Policy: **enforce-when-present, fail-open-when-absent.** If the client
 * declares roots, a path outside every root is rejected. If the client does
 * not support roots (or lists none), we allow the path and log a notice — this
 * keeps the server usable with clients that haven't adopted roots yet.
 */

interface Root {
  readonly uri: string;
  readonly name?: string | undefined;
}

/** Minimal slice of the MCP `Server` we depend on (keeps this unit testable). */
export interface RootsCapableServer {
  getClientCapabilities(): { readonly roots?: unknown } | undefined;
  listRoots(): Promise<{ readonly roots: readonly Root[] }>;
}

/**
 * Convert MCP roots to absolute directory paths. Only `file:` URIs are
 * meaningful for local sandboxing; any other scheme is ignored.
 */
export function rootsToDirs(roots: readonly Root[]): string[] {
  const dirs: string[] = [];
  for (const root of roots) {
    if (!root.uri.startsWith("file:")) continue;
    try {
      dirs.push(resolve(fileURLToPath(root.uri)));
    } catch {
      // Malformed file:// URI — skip rather than crash the whole check.
    }
  }
  return dirs;
}

/**
 * True if `candidate` resolves to a location inside (or equal to) any of
 * `rootDirs`. Pure and synchronous so it can be unit-tested directly.
 *
 * An empty `rootDirs` returns false — callers decide whether "no roots" means
 * fail-open (allow) or fail-closed (deny). Containment is checked on resolved
 * absolute paths with a separator boundary, so `/srv/data-evil` is NOT treated
 * as being inside `/srv/data`.
 */
export function isWithinRoots(candidate: string, rootDirs: readonly string[]): boolean {
  const resolved = resolve(candidate);
  for (const dir of rootDirs) {
    const root = resolve(dir);
    if (resolved === root || resolved.startsWith(root + sep)) return true;
  }
  return false;
}

/**
 * Throw if `candidatePath` falls outside the client's declared roots.
 * No-op (with a logged notice) when the client doesn't support roots or
 * advertises none.
 */
export async function assertPathWithinRoots(
  server: RootsCapableServer,
  candidatePath: string,
  label: string,
): Promise<void> {
  const caps = server.getClientCapabilities();
  if (!caps?.roots) {
    console.error(
      `[harbor-mcp] Client does not support MCP roots — ${label} path not sandboxed: ${candidatePath}`,
    );
    return;
  }

  let rootDirs: string[];
  try {
    const { roots } = await server.listRoots();
    rootDirs = rootsToDirs(roots);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[harbor-mcp] Failed to list MCP roots (${message}) — ${label} path not sandboxed: ${candidatePath}`,
    );
    return;
  }

  if (rootDirs.length === 0) {
    console.error(
      `[harbor-mcp] Client declared no usable roots — ${label} path not sandboxed: ${candidatePath}`,
    );
    return;
  }

  if (!isWithinRoots(candidatePath, rootDirs)) {
    throw new Error(
      `${label} path "${candidatePath}" is outside the allowed workspace roots ` +
        `(${rootDirs.join(", ")}). Move the file into a permitted root or adjust your MCP client's roots.`,
    );
  }
}
