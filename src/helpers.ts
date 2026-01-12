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

/**
 * Verify that action is not taking place outside of the current working directory
 */

export function verifyActionInWorkingDirectory(absolutePath: string) {
  const cwdRoot = process.cwd();
  if (
    absolutePath !== cwdRoot &&
    !absolutePath.startsWith(cwdRoot + path.sep)
  ) {
    throw new Error(
      `Access outside working directory is not allowed: ${absolutePath}`
    );
  }
}
