import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "../app/components/markdown-message";

test("renders assistant Markdown instead of displaying Markdown syntax", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownMessage, {
      content: "**重要**\n\n- 文件一\n- 文件二",
    }),
  );

  assert.match(html, /<strong>重要<\/strong>/);
  assert.match(html, /<ul>/);
  assert.doesNotMatch(html, /\*\*重要\*\*/);
});

test("does not render raw HTML from an assistant response", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownMessage, {
      content: '<script>alert("xss")</script>',
    }),
  );

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
