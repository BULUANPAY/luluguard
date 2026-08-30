import assert from "node:assert/strict";
import { test } from "node:test";

import { mcpResultIsError, mcpResultText } from "../lib/mcp";

test("preserves a text MCP policy error without treating it as JSON", () => {
  const result = {
    isError: true,
    content: [
      {
        type: "text",
        text: "AI Agent is disabled by administrator policy",
      },
    ],
  };

  assert.equal(mcpResultIsError(result), true);
  assert.equal(
    mcpResultText(result),
    "AI Agent is disabled by administrator policy",
  );
});

test("recognizes a successful text MCP result", () => {
  const result = {
    content: [{ type: "text", text: JSON.stringify({ files: [] }) }],
  };

  assert.equal(mcpResultIsError(result), false);
  assert.deepEqual(JSON.parse(mcpResultText(result)), { files: [] });
});
