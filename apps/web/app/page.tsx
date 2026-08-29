"use client";
import { FormEvent, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };
type WorkflowAction = "chat" | "precheck" | "broker_quote" | "payment";
type WorkflowResponse = { preflightId?: string; readyForBroker?: boolean; quoteId?: string };
const documentOptions = [
  { type: "commercial_invoice", label: "商業發票", detail: "品名、價格、交易條件", required: true },
  { type: "packing_list", label: "裝箱單", detail: "件數、毛重與淨重", required: true },
  { type: "bill_of_lading", label: "海運提單", detail: "運送與提貨資料", required: true },
  { type: "certificate_of_origin", label: "產地證明", detail: "產地與優惠稅率佐證", required: false },
  { type: "product_specification", label: "產品規格書", detail: "型號、材質與用途", required: false },
  { type: "import_permit", label: "輸入許可證", detail: "受管制商品適用", required: false }
] as const;

export default function Home() {
  const [orderId, setOrderId] = useState("ORD-1001");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "你好，我是進口商 AI Agent。請選擇文件後先執行 AI 文件檢查與獨立估價。" }
  ]);
  const [loading, setLoading] = useState(false);
  const [preflightId, setPreflightId] = useState<string>();
  const [readyForBroker, setReadyForBroker] = useState(false);
  const [quoteId, setQuoteId] = useState<string>();
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([
    "commercial_invoice", "packing_list", "bill_of_lading",
    "certificate_of_origin", "product_specification"
  ]);

  function resetPreflight() {
    setPreflightId(undefined);
    setReadyForBroker(false);
    setQuoteId(undefined);
  }
  function toggleDocument(type: string) {
    resetPreflight();
    setSelectedDocuments(current =>
      current.includes(type) ? current.filter(item => item !== type) : [...current, type]
    );
  }
  async function runWorkflow(action: WorkflowAction, userContent: string) {
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: userContent }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          selectedDocuments,
          workflowAction: action,
          orderId,
          preflightId,
          quoteId
        })
      });
      const data = (await response.json()) as { answer?: string; error?: string; workflow?: WorkflowResponse };
      if (data.workflow?.preflightId) setPreflightId(data.workflow.preflightId);
      if (data.workflow?.readyForBroker !== undefined) setReadyForBroker(data.workflow.readyForBroker);
      if (data.workflow?.quoteId) setQuoteId(data.workflow.quoteId);
      setMessages(current => [
        ...current,
        { role: "assistant", content: data.answer ?? `錯誤：${data.error ?? "未知錯誤"}` }
      ]);
    } catch (error) {
      setMessages(current => [
        ...current,
        { role: "assistant", content: `錯誤：${error instanceof Error ? error.message : "無法連線"}` }
      ]);
    } finally {
      setLoading(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = message.trim();
    setMessage("");
    await runWorkflow("chat", content);
  }

  return (
    <main>
      <section className="panel">
        <p className="eyebrow">x402 IMPORTER</p>
        <h1>進口商 AI Agent</h1>
        <p className="intro">先由進口商 AI 獨立檢查與估價；你確認後才把文件傳給報關行詢價，付款則需再次明確核准。</p>
        <a className="admin-link" href="/admin/policy">開啟 Payment Policy 管理頁 →</a>
        <section className="documents" aria-labelledby="documents-title">
          <div className="documents-heading">
            <div><p className="section-kicker">MOCK DOCUMENTS</p><h2 id="documents-title">選擇要取得的文件</h2></div>
            <span>{selectedDocuments.length} / {documentOptions.length} 已選</span>
          </div>
          <label className="order-field" htmlFor="orderId">
            訂單編號
            <input id="orderId" value={orderId} onChange={event => { setOrderId(event.target.value); resetPreflight(); }} />
          </label>
          <div className="document-grid">
            {documentOptions.map(document => {
              const checked = selectedDocuments.includes(document.type);
              return (
                <label className={`document-card ${checked ? "selected" : ""}`} key={document.type}>
                  <input type="checkbox" checked={checked} onChange={() => toggleDocument(document.type)} />
                  <span className="checkmark" aria-hidden="true">{checked ? "✓" : ""}</span>
                  <span className="document-copy"><strong>{document.label}</strong><small>{document.detail}</small></span>
                  <em>{document.required ? "必要" : "視情況"}</em>
                </label>
              );
            })}
          </div>
          <p className="document-note">變更訂單或文件後，既有預檢會失效，必須重新由 AI 估價。</p>
          <div className="workflow-status">
            <span className={preflightId ? "done" : "active"}>1. AI 文件檢查與獨立估價</span>
            <span className={quoteId ? "done" : readyForBroker ? "active" : ""}>2. 確認後向報關行詢價</span>
            <span className={quoteId ? "active" : ""}>3. 明確核准後付款</span>
          </div>
          <div className="workflow-actions">
            <button type="button" disabled={loading || !orderId.trim() || selectedDocuments.length === 0}
              onClick={() => runWorkflow("precheck", `請針對訂單 ${orderId} 檢查文件並產生進口商獨立預估，不要聯絡報關行。`)}>
              {loading ? "AI 處理中…" : "AI 檢查並估價"}
            </button>
            {readyForBroker && preflightId && !quoteId && (
              <button type="button" className="secondary" disabled={loading}
                onClick={() => runWorkflow("broker_quote", `我確認進口商預估，請將訂單 ${orderId} 的文件送給報關行詢價並比較差異。`)}>
                確認預估並向報關行詢價
              </button>
            )}
            {quoteId && (
              <button type="button" className="payment" disabled={loading}
                onClick={() => runWorkflow("payment", `我明確同意並核准支付訂單 ${orderId}、報價 ${quoteId} 的報關行服務費。`)}>
                核准並支付報關行服務費
              </button>
            )}
          </div>
        </section>
        <div className="conversation" aria-live="polite">
          {messages.map((item, index) => (
            <div className={`message ${item.role}`} key={`${item.role}-${index}`}>
              <span>{item.role === "user" ? "你" : "進口商 AI"}</span><p>{item.content}</p>
            </div>
          ))}
          {loading && <div className="message assistant"><span>進口商 AI</span><p>處理中…</p></div>}
        </div>
        <form onSubmit={submit}>
          <label htmlFor="message">繼續對話或明確核准付款</label>
          <textarea id="message" value={message} onChange={event => setMessage(event.target.value)} rows={4} placeholder="例如：我確認支付這筆報關行服務費" />
          <button disabled={loading || !message.trim()}>{loading ? "AI 處理中…" : "送出訊息"}</button>
        </form>
      </section>
    </main>
  );
}
