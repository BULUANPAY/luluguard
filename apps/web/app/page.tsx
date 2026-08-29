"use client";
import { FormEvent, useEffect, useState, type JSX } from "react";
import { DocumentUpload } from "./components/document-upload";

type ChatMessage = { role: "user" | "assistant"; content: string };
type WorkflowAction = "chat" | "precheck" | "broker_quote" | "payment";
type WorkflowResponse = {
  preflightId?: string;
  readyForBroker?: boolean;
  quoteId?: string;
};
type EmployeeSession = {
  employee: {
    id: string;
    username: string;
    name: string;
    tenantId: string;
    legalEntityName: string;
    lei: string;
    role: string;
    allowedActions: WorkflowAction[];
  };
  sessionId: string;
  expiresAt: string;
};
type VleiAuthorizationSummary = {
  authorizationId: string;
  signerAid: string;
  signerCredentialSaid: string;
};
const orderOptions = ["ORD-1001", "ORD-1002", "ORD-1003", "ORD-1004"];

export default function Home(): JSX.Element {
  const [session, setSession] = useState<EmployeeSession>();
  const [sessionLoading, setSessionLoading] = useState(true);
  const [username, setUsername] = useState("alice");
  const [password, setPassword] = useState("alice-demo");
  const [loginError, setLoginError] = useState("");
  const [orderId, setOrderId] = useState("ORD-1001");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "你好，我是進口商 AI Agent。請先上傳訂單文件，再執行 AI 文件檢查與獨立估價。",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [preflightId, setPreflightId] = useState<string>();
  const [readyForBroker, setReadyForBroker] = useState(false);
  const [quoteId, setQuoteId] = useState<string>();
  const [lastAuthorization, setLastAuthorization] =
    useState<VleiAuthorizationSummary>();

  useEffect(() => {
    void fetch("/api/auth/session")
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { session: EmployeeSession };
        setSession(data.session);
      })
      .finally(() => setSessionLoading(false));
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = (await response.json()) as {
      session?: EmployeeSession;
      error?: string;
    };
    if (!response.ok || !data.session) {
      setLoginError(data.error ?? "登入失敗");
      return;
    }
    setSession(data.session);
    setMessages([
      {
        role: "assistant",
        content: `你好 ${data.session.employee.name}，請選擇文件後以你的 sandbox vLEI 授權 AI Agent 執行任務。`,
      },
    ]);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(undefined);
    resetPreflight();
    setLastAuthorization(undefined);
  }

  function resetPreflight() {
    setPreflightId(undefined);
    setReadyForBroker(false);
    setQuoteId(undefined);
  }
  async function runWorkflow(action: WorkflowAction, userContent: string) {
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userContent },
    ];
    setMessages(nextMessages);
    setLoading(true);
    setProgress("正在送出提問…");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          workflowAction: action,
          orderId,
          preflightId,
          quoteId,
        }),
      });
      const data = (await response.json()) as {
        answer?: string;
        error?: string;
        workflow?: WorkflowResponse;
        vleiAuthorization?: VleiAuthorizationSummary;
      };
      if (response.status === 401) setSession(undefined);
      if (data.workflow?.preflightId) setPreflightId(data.workflow.preflightId);
      if (data.workflow?.readyForBroker !== undefined)
        setReadyForBroker(data.workflow.readyForBroker);
      if (data.workflow?.quoteId) setQuoteId(data.workflow.quoteId);
      if (data.vleiAuthorization) setLastAuthorization(data.vleiAuthorization);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer ?? `錯誤：${data.error ?? "未知錯誤"}`,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `錯誤：${error instanceof Error ? error.message : "無法連線"}`,
        },
      ]);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = message.trim();
    setMessage("");
    await runWorkflow("chat", content);
  }

  if (sessionLoading) {
    return (
      <main>
        <section className="panel login-panel">
          <p>正在載入員工 session…</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main>
        <section className="panel login-panel">
          <p className="eyebrow">SANDBOX vLEI LOGIN</p>
          <h1>進口商員工登入</h1>
          <p className="intro">
            登入後，每次工作流操作都會用該員工的 sandbox vLEI 簽署 Agent
            Authorization。
          </p>
          <form onSubmit={login} className="login-form">
            <label htmlFor="username">
              員工帳號
              <input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label htmlFor="password">
              密碼
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {loginError && <p className="login-error">{loginError}</p>}
            <button>登入</button>
          </form>
          <div className="demo-accounts">
            <strong>Sandbox 帳號</strong>
            <span>
              Alice：<code>alice / alice-demo</code>（可預檢、詢價、付款）
            </span>
            <span>
              Bob：<code>bob / bob-demo</code>（可預檢、詢價）
            </span>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="panel">
        <p className="eyebrow">x402 IMPORTER</p>
        <h1>進口商 AI Agent</h1>
        <p className="intro">
          先由進口商 AI
          獨立檢查與估價；你確認後才把文件傳給報關行詢價，付款則需再次明確核准。
        </p>
        <div className="employee-card">
          <div>
            <strong>{session.employee.name}</strong>
            <span>{session.employee.role}</span>
            <small>
              {session.employee.legalEntityName} · LEI {session.employee.lei}
            </small>
          </div>
          <button type="button" className="logout" onClick={logout}>
            登出
          </button>
        </div>
        {lastAuthorization && (
          <div className="vlei-status">
            <strong>✓ vLEI Agent Authorization 已簽署並送交驗證</strong>
            <span>{lastAuthorization.authorizationId}</span>
            <small>Signer AID：{lastAuthorization.signerAid}</small>
          </div>
        )}
        <a className="admin-link" href="/admin/policy">
          開啟 Payment Policy 管理頁 →
        </a>
        <section className="documents" aria-labelledby="documents-title">
          <div className="documents-heading">
            <div>
              <p className="section-kicker">ORDER WORKFLOW</p>
              <h2 id="documents-title">文件檢查與估價流程</h2>
            </div>
          </div>
          <label className="order-field" htmlFor="orderId">
            訂單編號
            <input
              id="orderId"
              value={orderId}
              onChange={(event) => {
                setOrderId(event.target.value);
                resetPreflight();
              }}
            />
          </label>
          <p className="document-note">
            AI 會讀取此訂單目前已上傳的文件（見下方「上傳訂單文件」）進行檢查與獨立估價。變更訂單或上傳文件後，既有預檢會失效，必須重新由 AI 檢查。
          </p>
          <div className="workflow-status">
            <span className={preflightId ? "done" : "active"}>
              1. AI 文件檢查與獨立估價
            </span>
            <span className={quoteId ? "done" : readyForBroker ? "active" : ""}>
              2. 確認後向報關行詢價
            </span>
            <span className={quoteId ? "active" : ""}>3. 明確核准後付款</span>
          </div>
          <div className="workflow-actions">
            <button
              type="button"
              disabled={loading || !orderId.trim()}
              onClick={() =>
                runWorkflow(
                  "precheck",
                  `請針對訂單 ${orderId} 檢查文件並產生進口商獨立預估，不要聯絡報關行。`,
                )
              }
            >
              {loading ? "AI 處理中…" : "以 vLEI 授權 AI 檢查並估價"}
            </button>
            {readyForBroker && preflightId && !quoteId && (
              <button
                type="button"
                className="secondary"
                disabled={loading}
                onClick={() =>
                  runWorkflow(
                    "broker_quote",
                    `我確認進口商預估，請將訂單 ${orderId} 的文件送給報關行詢價並比較差異。`,
                  )
                }
              >
                以 vLEI 授權向報關行詢價
              </button>
            )}
            {quoteId && session.employee.allowedActions.includes("payment") && (
              <button
                type="button"
                className="payment"
                disabled={loading}
                onClick={() =>
                  runWorkflow(
                    "payment",
                    `我明確同意並核准支付訂單 ${orderId}、報價 ${quoteId} 的報關行服務費。`,
                  )
                }
              >
                以 vLEI 核准並支付報關行服務費
              </button>
            )}
            {quoteId &&
              !session.employee.allowedActions.includes("payment") && (
                <p className="role-blocked">
                  你的 vLEI 角色沒有付款權限，請由 Import Operations Manager
                  登入核准。
                </p>
              )}
          </div>
        </section>
        <DocumentUpload orderId={orderId} />
        <div className="conversation" aria-live="polite">
          {messages.map((item, index) => (
            <div
              className={`message ${item.role}`}
              key={`${item.role}-${index}`}
            >
              <span>{item.role === "user" ? "你" : "進口商 AI"}</span>
              <p>{item.content}</p>
            </div>
          ))}
          {loading && <div className="message assistant"><span>進口商 AI</span><p>{progress || "處理中…"}</p></div>}
        </div>
        <form onSubmit={submit}>
          <label htmlFor="message">繼續對話或明確核准付款</label>
          <textarea
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            placeholder="例如：我確認支付這筆報關行服務費"
          />
          <button disabled={loading || !message.trim()}>
            {loading ? "AI 處理中…" : "送出訊息"}
          </button>
        </form>
      </section>
    </main>
  );
}
