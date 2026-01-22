# mini-code

This project implements a tiny cli coding agent built for educational purposes, and for some fun.

### Functionality overview:

- A CLI-based agent that talks with you and can perform simple filesystem operations via a small toolset defined in main.ts.
- Tools implemented: list_files, read_file, edit_file. These allow listing directories, reading file contents, and editing files via first-occurrence replacement (or creating new files).
- The agent is hardcoded ot use OpenAI's `gpt-5.2` model.
- An `.agentignore` file can be setup to hide any files or directories from the agent

### Requirements:

- Node.js (LTS recommended)
- npm (comes with Node) or pnpm/yarn
- OPENAI_API_KEY in a .env file or environment

### Usage:

```
npm ci
npm run dev
```

### Notes:

- This is a barebones coding agent, it does not have robust safety mechanisms, error handling, or planning functionality.

### Roadmap:

- Improved TUI with `ink` or `opentui`
- Plan vs Build modes
- Prompt optimization
- Agent tracking interal list of TODOs before completion
