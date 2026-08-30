import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import React, { type JSX } from "react";

type MarkdownMessageProps = {
  content: string;
};

export function MarkdownMessage({ content }: MarkdownMessageProps): JSX.Element {
  return (
    <Markdown remarkPlugins={[remarkGfm]}>
      {content}
    </Markdown>
  );
}
