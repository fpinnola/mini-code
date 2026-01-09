import OpenAI from "openai";
import "dotenv/config";
import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  ResponseInputItem,
  Tool,
} from "openai/resources/responses/responses.js";

const openai_client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

/**
 * Resolves any path (relative or absolute) to an absolute path
 * using the current working directory as the base.
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
 * Give a file path, returns the content of that file
 *    - expects utf-8 encoding
 */
async function readFileContent(filePath: string) {
  const absolutePath = resolveAbsolutePath(filePath);
  const fileContent = await readFile(absolutePath, "utf-8");
  return fileContent;
}

/**
 * Given a directory, returns all files and subdirectories
 */
async function listFiles(dir: string = process.cwd()) {
  const absolute_path = resolveAbsolutePath(dir);
  const files = (await readdir(absolute_path, { withFileTypes: true })).map(
    (file) => ({
      filename: file.name,
      type: file.isDirectory() ? "dir" : "file",
    })
  );
  return {
    path: absolute_path,
    files,
  };
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
) {
  const absolutePath = resolveAbsolutePath(filePath);
  const original = await readFileContent(absolutePath);

  const index = original.indexOf(oldContent);
  if (index === -1) return false;
  const updated =
    original.slice(0, index) +
    newContent +
    original.slice(index + oldContent.length);

  await writeFile(absolutePath, updated, "utf-8");
  return true;
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
];

type ToolResult = string;

async function runTool(name: string, args: any): Promise<ToolResult> {
  console.log(` -- Calling tool ${name} with args ${JSON.stringify(args)}`);
  switch (name) {
    case "list_files": {
      const dir = typeof args?.dir === "string" ? args.dir : process.cwd();
      return JSON.stringify(await listFiles(dir));
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
    model: "gpt-5-nano",
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
