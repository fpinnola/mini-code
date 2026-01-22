import {
  ResponseInputItem,
  Tool,
} from "openai/resources/responses/responses.js";
import { isPathIgnored } from "./agentignore.js";
import {
  resolveAbsolutePath,
  verifyActionInWorkingDirectory,
} from "./helpers.js";

import "dotenv/config";
import { readdir, readFile, writeFile } from "fs/promises";
import { access, mkdir } from "node:fs/promises";
import { constants } from "fs";
import path, { dirname } from "node:path";

/**
 * Give a file path, returns the content of that file
 *    - expects utf-8 encoding
 */
async function readFileContent(filePath: string) {
  const absolutePath = resolveAbsolutePath(filePath);
  verifyActionInWorkingDirectory(absolutePath);
  const fileContent = await readFile(absolutePath, "utf-8");
  return fileContent;
}

/**
 * Given a directory, returns all files and subdirectories
 */
async function listFiles(dir: string = process.cwd()) {
  const absolutePath = resolveAbsolutePath(dir);
  verifyActionInWorkingDirectory(absolutePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });

  // Check files for visibility based on user settings
  const withVisibility = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(absolutePath, entry.name);
      const ignored = await isPathIgnored(fullPath);
      return { entry, ignored };
    })
  );

  const files = withVisibility
    .filter(({ ignored }) => !ignored)
    .map(({ entry }) => ({
      filename: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }));

  return {
    path: absolutePath,
    files,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function createNewFile(initialContent: string): Promise<string> {
  const fileName = `new_file_${Date.now()}.txt`;
  const absolutePath = resolveAbsolutePath(fileName);
  await writeFile(absolutePath, initialContent, "utf-8");
  return absolutePath;
}

/**
 * Given a file, a string to replace, and a new string
 *    this tool will update the file and write out
 *
 * Returns boolean on success of the operation
 *
 */
async function editFile(
  filePath: string,
  oldContent: string,
  newContent: string
): Promise<{ created: boolean; edited: boolean; path: string }> {
  const absolutePath = resolveAbsolutePath(filePath);
  verifyActionInWorkingDirectory(absolutePath);

  const exists = await fileExists(absolutePath);

  // Create if missing
  if (!exists) {
    // ensure parent directories exist (supports nested paths like src/foo/bar.ts)
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, newContent, "utf-8");
    return { created: true, edited: false, path: absolutePath };
  }

  // Otherwise edit in place (first occurrence)
  const original = await readFileContent(absolutePath);

  if (!original.includes(oldContent)) {
    return { created: false, edited: false, path: absolutePath };
  }

  const updated = original.replace(oldContent, newContent);
  await writeFile(absolutePath, updated, "utf-8");
  return { created: false, edited: true, path: absolutePath };
}

export const tools: Tool[] = [
  {
    type: "function",
    name: "list_files",
    description:
      "list all files and subdirectories in the given directory. Can pass in absolute or relative path",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the directory to list files under",
        },
      },
      additionalProperties: false,
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "read_file",
    description:
      "read the text content of a file at the given path. Can pass in absolute or relative path",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the file to read",
        },
      },
      additionalProperties: false,
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "edit_file",
    description:
      "Edit a file by replacing the first occurrence of oldContent with newContent. If the file at filePath does not exist yet, it will be created and initialized with newContent (oldContent is ignored in that case).",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path of the file to edit or create (relative or absolute).",
        },
        oldContent: {
          type: "string",
          description:
            "Text to be replaced (first occurrence). If the file does not exist, this is ignored.",
        },
        newContent: {
          type: "string",
          description:
            "Replacement text. If the file does not exist, this becomes the file's initial content.",
        },
      },
      additionalProperties: false,
      required: ["path", "oldContent", "newContent"],
    },
  },
];

type ToolResult = string;

export async function runTool(name: string, args: any): Promise<ToolResult> {
  console.log(` -- Calling tool ${name} with args ${JSON.stringify(args)}`);
  if (args?.path) {
    if (await isPathIgnored(args.path)) {
      throw new Error(
        `Access to path '${args.path}' is denied by .agentignore`
      );
    }
  }
  switch (name) {
    case "list_files": {
      const dirPath =
        typeof args?.path === "string" ? args.path : process.cwd();
      return JSON.stringify(await listFiles(dirPath));
    }
    case "read_file": {
      const filePath = args.path;
      return JSON.stringify(await readFileContent(filePath));
    }
    case "edit_file": {
      const filePath = args.path;
      const oldContent = args.oldContent;
      const newContent = args.newContent;
      if (typeof filePath === "string" && filePath.trim() !== "") {
        const result = await editFile(filePath, oldContent, newContent);
        // result is a boolean
        return JSON.stringify({ edited: result });
      } else {
        const createdPath = await createNewFile(newContent);
        return JSON.stringify({ created: true, path: createdPath });
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export type FunctionCallOutputItem = Extract<
  ResponseInputItem,
  { type: "function_call_output" }
>;
