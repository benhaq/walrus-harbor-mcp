import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isWithinRoots, rootsToDirs } from "../src/pathSandbox.js";

describe("isWithinRoots", () => {
  const root = join("/srv", "data");

  it("allows a file directly inside a root", () => {
    expect(isWithinRoots(join(root, "report.pdf"), [root])).toBe(true);
  });

  it("allows a file in a nested subdirectory", () => {
    expect(isWithinRoots(join(root, "2026", "q1", "report.pdf"), [root])).toBe(true);
  });

  it("allows the root path itself", () => {
    expect(isWithinRoots(root, [root])).toBe(true);
  });

  it("rejects a path outside every root", () => {
    expect(isWithinRoots(join("/etc", "passwd"), [root])).toBe(false);
  });

  it("rejects a sibling sharing a name prefix (no separator boundary)", () => {
    expect(isWithinRoots(`${root}-evil/secret`, [root])).toBe(false);
  });

  it("rejects parent-traversal that escapes the root", () => {
    expect(isWithinRoots(join(root, "..", "other", "x"), [root])).toBe(false);
  });

  it("allows when the candidate is within any one of several roots", () => {
    const roots = [join("/srv", "a"), join("/srv", "b")];
    expect(isWithinRoots(join("/srv", "b", "file"), roots)).toBe(true);
  });

  it("returns false for an empty root list (caller decides fail-open)", () => {
    expect(isWithinRoots(join(root, "x"), [])).toBe(false);
  });
});

describe("rootsToDirs", () => {
  it("converts file:// URIs to absolute paths", () => {
    const dir = join("/srv", "data");
    const dirs = rootsToDirs([{ uri: pathToFileURL(dir).href }]);
    expect(dirs).toEqual([dir]);
  });

  it("skips non-file URI schemes", () => {
    const dir = join("/srv", "data");
    const dirs = rootsToDirs([{ uri: "https://example.com/x" }, { uri: pathToFileURL(dir).href }]);
    expect(dirs).toEqual([dir]);
  });

  it("returns an empty list when no roots are file URIs", () => {
    expect(rootsToDirs([{ uri: "https://example.com" }])).toEqual([]);
  });
});
