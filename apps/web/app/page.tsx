"use client";
import { FormEvent, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "你好，我是進口商 AI Agent。請告訴我訂單編號與報關需求。" }
  ]);
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: message.trim() }];
    setMessages(nextMessages);
    setMessage("");
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages })
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.answer ?? `錯誤：${data.error ?? "未知錯誤"}` }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `錯誤：${error instanceof Error ? error.message : "無法連線"}` }
      ]);
    } finally {
      setLoading(false);
    }
  }
  return (
    <main>
      <section className="panel">
        <p className="eyebrow">x402 IMPORTER</p>
        <h1>進口商 AI Agent</h1>
        <p className="intro">透過獨立 MCP Server 取得文件、聯絡報關行，並在你核准後使用測試網 USDC 付款。</p>
        <div className="conversation" aria-live="polite">
          {messages.map((item, index) => (
            <div className={`message ${item.role}`} key={`${item.role}-${index}`}>
              <span>{item.role === "user" ? "你" : "進口商 AI"}</span>
              <p>{item.content}</p>
            </div>
          ))}
          {loading && <div className="message assistant"><span>進口商 AI</span><p>處理中…</p></div>}
        </div>
        <form onSubmit={submit}>
          <label htmlFor="message">繼續對話</label>
          <textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} rows={4} placeholder="例如：訂單 ORD-1001，先告訴我付款資訊" />
          <button disabled={loading || !message.trim()}>{loading ? "AI 處理中…" : "送出"}</button>
        </form>
      </section>
    </main>
  );
}
