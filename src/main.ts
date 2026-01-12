import OpenAI from "openai";
import "dotenv/config";
import { readdir, readFile, writeFile } from "fs/promises";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  ResponseInputItem,
  Tool,
} from "openai/resources/responses/responses.js";
import { access, mkdir } from "node:fs/promises";
import { constants } from "fs";
import path, { dirname } from "node:path";
import { isPathIgnored } from "./agentignore.js";
import {
  resolveAbsolutePath,
  verifyActionInWorkingDirectory,
} from "./helpers.js";

const openai_client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

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

const tools: Tool[] = [
  {
    type: "function",
    name: "list_files",
    description:
      "list all files and subdirectories in the given directory. Can pass in absolute or relative path",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Path of the directory to list files under",
        },
      },
      additionalProperties: false,
      required: ["dir"],
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
        filePath: {
          type: "string",
          description: "Path of the file to read",
        },
      },
      additionalProperties: false,
      required: ["filePath"],
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
        filePath: {
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
      required: ["filePath", "oldContent", "newContent"],
    },
  },
];

type ToolResult = string;

async function runTool(name: string, args: any): Promise<ToolResult> {
  console.log(` -- Calling tool ${name} with args ${JSON.stringify(args)}`);
  switch (name) {
    case "list_files": {
      const dir = typeof args?.dir === "string" ? args.dir : process.cwd();
      if (await isPathIgnored(dir)) {
        throw new Error(`Access to path '${dir}' is denied by .agentignore`);
      }
      return JSON.stringify(await listFiles(dir));
    }
    case "read_file": {
      const filePath = args.filePath;
      if (await isPathIgnored(filePath)) {
        throw new Error(
          `Access to path '${filePath}' is denied by .agentignore`
        );
      }
      return JSON.stringify(await readFileContent(filePath));
    }
    case "edit_file": {
      const filePath = args.filePath;
      const oldContent = args.oldContent;
      const newContent = args.newContent;
      if (await isPathIgnored(filePath)) {
        throw new Error(
          `Access to path '${filePath}' is denied by .agentignore`
        );
      }
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

type FunctionCallOutputItem = Extract<
  ResponseInputItem,
  { type: "function_call_output" }
>;

async function llmCompletion(messages: Message[]): Promise<string> {
  let response = await openai_client.responses.create({
    model: "gpt-5.2",
    tools,
    input: messages,
  });

  while (true) {
    const toolCalls = response.output.filter(
      (item) => item.type === "function_call"
    );

    if (toolCalls.length === 0) {
      return response.output_text;
    }

    // Execute each tool call
    const toolOutputs: FunctionCallOutputItem[] = [];
    for (const call of toolCalls) {
      const args =
        typeof call.arguments === "string"
          ? JSON.parse(call.arguments)
          : call.arguments;

      const result = await runTool(call.name, args);

      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: result,
      });
    }

    // Send tool outputs back, linked to the previous response
    response = await openai_client.responses.create({
      model: "gpt-5-nano",
      previous_response_id: response.id,
      input: toolOutputs,
      tools,
    });
  }
}

type Role = "developer" | "user" | "assistant";

type Message = {
  role: Role;
  content: string;
};

function erasePreviousPromptLine() {
  // Move cursor to the line with the prompt + input, then clear it.
  readline.moveCursor(output, 0, -1); // go up 1 line
  readline.cursorTo(output, 0); // col 0
  readline.clearLine(output, 0); // clear entire line
}

async function run() {
  console.log("Chat with Frank (use ctrl-c or 'quit' to quit)");

  const rl = readline.createInterface({ input, output });

  const conversation: Message[] = [];

  while (true) {
    const userInput: string = await new Promise((resolve) => {
      rl.question("> ", resolve);
    });

    // TODO: fix, this only seems to work sporadically
    erasePreviousPromptLine();

    // Handle input
    console.log("You:", userInput, "\n");
    conversation.push({ role: "user", content: userInput });

    try {
      const agentResponse = await llmCompletion(conversation);
      console.log("Agent:", agentResponse, "\n");
      conversation.push({ role: "assistant", content: agentResponse });
    } catch (err) {
      console.error("Agent call failed:", err);
    }

    if (userInput.trim().toLowerCase() === "quit") {
      break;
    }
  }

  return;
}

async function main() {
  run();
}

main();
