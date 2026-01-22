import OpenAI from "openai";
import "dotenv/config";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { FunctionCallOutputItem, runTool, tools } from "./tools.js";

const openai_client = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

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
