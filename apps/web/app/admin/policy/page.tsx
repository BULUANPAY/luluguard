"use client";
import { FormEvent, type ReactNode, useState } from "react";

type Status = "ACTIVE" | "PAYMENT_PAUSED" | "DISABLED";
type Policy = {
  status: Status;
  version: number;
  updatedAt: string;
  maxPaymentUsd: number;
  maxDailySpendUsd: number;
  maxPaymentsPerHour: number;
  requireHumanApprovalAboveUsd: number;
  allowedPayees: string[];
};

export default function PolicyAdminPage(): ReactNode {
  const [policyAdminKey, setPolicyAdminKey] = useState("");
  const [policy, setPolicy] = useState<Policy>();
  const [usage, setUsage] = useState<{ paymentRecords: number; settledUsdc: number }>();
  const [message, setMessage] = useState("請輸入管理金鑰並載入目前設定。");
  const [loading, setLoading] = useState(false);

  async function request(method: "GET" | "PUT", body?: unknown) {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/policy", {
        method,
        headers: { "Content-Type": "application/json", "X-Policy-Admin-Key": policyAdminKey },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setPolicy(data.policy);
      if (data.usage) setUsage(data.usage);
      setMessage(method === "PUT" ? "Policy 已更新並立即生效。" : "已載入目前 Runtime Policy。");
    } catch (error) {
      setMessage(`錯誤：${error instanceof Error ? error.message : "無法連線"}`);
    } finally {
      setLoading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;
    await request("PUT", {
      status: policy.status,
      maxPaymentUsd: Number(policy.maxPaymentUsd),
      maxDailySpendUsd: Number(policy.maxDailySpendUsd),
      maxPaymentsPerHour: Number(policy.maxPaymentsPerHour),
      requireHumanApprovalAboveUsd: Number(policy.requireHumanApprovalAboveUsd),
      allowedPayees: policy.allowedPayees
    });
  }

  return <main>
    <section className="panel admin-panel">
      <p className="eyebrow">PAYMENT GOVERNANCE</p>
      <h1>AI Agent Policy</h1>
      <p className="intro">動態調整付款限制或立即停止 Agent。這個頁面不會取得私鑰，也不能直接呼叫 signer。</p>
      <div className="admin-auth">
        <label>Policy 管理金鑰<input type="password" value={policyAdminKey} onChange={event => setPolicyAdminKey(event.target.value)} autoComplete="current-password" /></label>
        <button type="button" disabled={loading || !policyAdminKey} onClick={() => request("GET")}>載入 Policy</button>
      </div>
      <p className="admin-message" role="status">{message}</p>
      {policy && <form className="policy-form" onSubmit={save}>
        <div className="kill-switches">
          <button type="button" className="secondary" disabled={loading} onClick={() => request("PUT", { status: "PAYMENT_PAUSED" })}>暫停所有付款</button>
          <button type="button" className="danger" disabled={loading} onClick={() => request("PUT", { status: "DISABLED" })}>停用 AI Agent</button>
          <button type="button" disabled={loading} onClick={() => request("PUT", { status: "ACTIVE" })}>恢復啟用</button>
        </div>
        <div className={`policy-state ${policy.status.toLowerCase()}`}>
          <strong>{policy.status}</strong><span>Version {policy.version} · {new Date(policy.updatedAt).toLocaleString("zh-TW")}</span>
        </div>
        <div className="policy-grid">
          <label>Agent 狀態<select value={policy.status} onChange={event => setPolicy({ ...policy, status: event.target.value as Status })}><option>ACTIVE</option><option>PAYMENT_PAUSED</option><option>DISABLED</option></select></label>
          <label>單筆上限（USDC）<input type="number" min="0" step="0.000001" value={policy.maxPaymentUsd} onChange={event => setPolicy({ ...policy, maxPaymentUsd: Number(event.target.value) })} /></label>
          <label>24 小時累計上限（USDC）<input type="number" min="0" step="0.000001" value={policy.maxDailySpendUsd} onChange={event => setPolicy({ ...policy, maxDailySpendUsd: Number(event.target.value) })} /></label>
          <label>每小時付款次數<input type="number" min="1" step="1" value={policy.maxPaymentsPerHour} onChange={event => setPolicy({ ...policy, maxPaymentsPerHour: Number(event.target.value) })} /></label>
          <label>超過此金額需人工核准<input type="number" min="0" step="0.000001" value={policy.requireHumanApprovalAboveUsd} onChange={event => setPolicy({ ...policy, requireHumanApprovalAboveUsd: Number(event.target.value) })} /></label>
          <label className="wide">允許的收款地址（一行一個）<textarea rows={4} value={policy.allowedPayees.join("\n")} onChange={event => setPolicy({ ...policy, allowedPayees: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} /></label>
        </div>
        {usage && <p className="usage">本次 MCP 執行期間：{usage.paymentRecords} 筆成功付款，共 {usage.settledUsdc} USDC</p>}
        <button disabled={loading}>{loading ? "儲存中…" : "儲存並立即套用"}</button>
      </form>}
    </section>
  </main>;
}
