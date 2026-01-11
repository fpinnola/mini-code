import path from "path";
import { readFile } from "fs/promises";
import { resolveAbsolutePath } from "./helpers.js";

// Simple in-process cache for .agentignore
let _agentIgnoreCache: Set<string> | null = null;

/**
 * Load and cache the agent ignore list from the project root (.agentignore).
 * Paths are resolved to absolute paths for robust comparisons.
 */
export async function getAgentIgnoreSet(): Promise<Set<string>> {
  if (_agentIgnoreCache) return _agentIgnoreCache;

  const ignoreFilePath = path.resolve(process.cwd(), ".agentignore");
  const ig = new Set<string>();

  try {
    const content = await readFile(ignoreFilePath, "utf-8");
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    for (const line of lines) {
      // Treat each line as a path. Resolve to absolute for robust comparison.
      ig.add(resolveAbsolutePath(line));
    }
  } catch {
    // If the file doesn't exist or can't be read, behave as if nothing is ignored.
  }

  _agentIgnoreCache = ig;
  return ig;
}

/**
 * Check whether a given target path should be ignored by .agentignore.
 * - If the path is absolute, compare directly to the ignore set.
 * - If the path is relative, resolve to absolute first.
 * - If any ignore entry is exactly the path or a parent directory of the path, consider it ignored.
 */
export async function isPathIgnored(targetPath: string): Promise<boolean> {
  if (!targetPath) return false;

  const absTarget = resolveAbsolutePath(targetPath);
  const ignoreSet = await getAgentIgnoreSet();

  for (const ig of ignoreSet) {
    // Exact match
    if (absTarget === ig) return true;
    // If the target is inside an ignored directory (ig is a dir or path prefix)
    if (absTarget.startsWith(ig.endsWith(path.sep) ? ig : ig + path.sep)) {
      return true;
    }
  }
  return false;
}
