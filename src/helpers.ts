import path from "path";

/**
 * Resolve a path (relative or absolute) to an absolute path anchored at CWD.
 */
export function resolveAbsolutePath(inputPath: string): string {
  if (!inputPath) {
    return process.cwd();
  }
  return path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(process.cwd(), inputPath);
}
