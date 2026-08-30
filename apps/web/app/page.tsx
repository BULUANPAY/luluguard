"use client";
import { FormEvent, useEffect, useState, type JSX } from "react";
import { DocumentUpload } from "./components/document-upload";
import { LetterOfAuthorization } from "./components/letter-of-authorization";
import { MarkdownMessage } from "./components/markdown-message";
import exampleOrders from "./example-orders.json";

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
  powerOfAttorneyDocumentId?: string;
};

export default function Home(): JSX.Element {
  const [session, setSession] = useState<EmployeeSession>();
  const [sessionLoading, setSessionLoading] = useState(true);
  const [username, setUsername] = useState("alice");
  const [password, setPassword] = useState("alice-demo");
  const [loginError, setLoginError] = useState("");
  const [orderId, setOrderId] = useState(exampleOrders[0]?.orderId ?? "");
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
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [lastAuthorization, setLastAuthorization] =
    useState<VleiAuthorizationSummary>();
  const selectedOrder = exampleOrders.find((order) => order.orderId === orderId);
  const currentStep = quoteId ? 3 : readyForBroker && preflightId ? 2 : 1;

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
    setAuthorizationOpen(false);
  }

  function confirmBrokerAuthorization(acceptedAt: string) {
    setAuthorizationOpen(false);
    void runWorkflow(
      "broker_quote",
      `我確認進口商預估，並已閱讀及同意訂單 ${orderId} 的報關作業委託書，授權將本訂單文件送交報關行詢價並比較差異。`,
      { customsAuthorizationAcceptedAt: acceptedAt },
    );
  }
  async function runWorkflow(
    action: WorkflowAction,
    userContent: string,
    options: { customsAuthorizationAcceptedAt?: string } = {},
  ) {
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
          customsAuthorizationAcceptedAt:
            options.customsAuthorizationAcceptedAt,
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
      if (
        action === "precheck" &&
        data.workflow?.preflightId &&
        data.workflow.readyForBroker
      ) {
        setAuthorizationOpen(true);
      }
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
        <nav className="workflow-progress" aria-label="進口報關工作進度">
          {[
            {
              step: 1,
              title: "AI 文件檢查與獨立估價",
              detail: "檢查已上傳文件",
            },
            {
              step: 2,
              title: "閱讀並同意委託書",
              detail: "附上 vLEI 委任紀錄",
            },
            {
              step: 3,
              title: "明確核准後付款",
              detail: "確認報價與服務費",
            },
          ].map((item) => {
            const state =
              item.step < currentStep
                ? "done"
                : item.step === currentStep
                  ? "active"
                  : "pending";
            return (
              <div className={`workflow-progress-step ${state}`} key={item.step}>
                <span>{state === "done" ? "✓" : item.step}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
              </div>
            );
          })}
        </nav>
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
            {lastAuthorization.powerOfAttorneyDocumentId && (
              <small>
                委任書附件：{lastAuthorization.powerOfAttorneyDocumentId}
              </small>
            )}
          </div>
        )}
        <a className="admin-link" href="/admin/policy">
          開啟 Payment Policy 管理頁 →
        </a>
        <section className="order-context" aria-labelledby="order-context-title">
          <div>
            <p className="section-kicker">CURRENT ORDER</p>
            <h2 id="order-context-title">選擇要處理的訂單</h2>
          </div>
          <label className="order-field" htmlFor="orderId">
            訂單編號
            <select
              id="orderId"
              value={orderId}
              onChange={(event) => {
                setOrderId(event.target.value);
                resetPreflight();
              }}
            >
              {exampleOrders.map((order) => (
                <option key={order.orderId} value={order.orderId}>
                  {order.orderId} — {order.importer.name} ({order.importer.lei})
                </option>
              ))}
            </select>
          </label>
        </section>
        <DocumentUpload orderId={orderId} onUploaded={resetPreflight} />
        <section className="documents" aria-labelledby="documents-title">
          <div className="documents-heading">
            <div>
              <p className="section-kicker">STEP 1 · AI REVIEW</p>
              <h2 id="documents-title">文件檢查與估價流程</h2>
            </div>
          </div>
          <p className="document-note">
            AI 會讀取上方已上傳的訂單文件進行檢查與獨立估價。檢查通過後會自動進入 Step 2，開啟報關委任書供你閱讀與同意。
          </p>
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
                onClick={() => setAuthorizationOpen(true)}
              >
                閱讀並同意報關委託書
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
        <div className="conversation" aria-live="polite">
          {messages.map((item, index) => (
            <div
              className={`message ${item.role}`}
              key={`${item.role}-${index}`}
            >
              <span>{item.role === "user" ? "你" : "進口商 AI"}</span>
              {item.role === "assistant" ? (
                <div className="message-content markdown">
                  <MarkdownMessage content={item.content} />
                </div>
              ) : (
                <p className="message-content">{item.content}</p>
              )}
            </div>
          ))}
          {loading && (
            <div className="message assistant">
              <span>進口商 AI</span>
              <p className="message-content">{progress || "處理中…"}</p>
            </div>
          )}
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
      {authorizationOpen && (
        <LetterOfAuthorization
          order={selectedOrder}
          signerName={session.employee.name}
          signerRole={session.employee.role}
          onClose={() => setAuthorizationOpen(false)}
          onConfirm={confirmBrokerAuthorization}
        />
      )}
    </main>
  );
}
