# LuLuGuard

LuLuGuard 是競賽用的進口商 AI Agent POC，展示 vLEI 授權、文件預檢、報關詢價、人工核准、x402 測試網付款與可驗證稽核紀錄。

## 執行方式

### 執行需求

- Node.js 24 以上（`.nvmrc` 指定 Node.js 26）
- pnpm 11.23.0
- Python 3.8 以上，供 vLEI 簽章與驗章使用
- Git submodule `vendor/vlei-sandbox`
- Gemini 或 OpenAI API key
- 完整 x402 付款 Demo：可連線的 Facilitator、專用 Base Sepolia 測試錢包、測試網 gas 與 USDC

### 安裝與設定

在 repository root 執行：

```sh
nvm use
git submodule update --init --recursive
pnpm install
cp .env.example .env
```

編輯 root `.env`，至少完成以下設定；其他可調整欄位與預設值見 [`.env.example`](.env.example)。

| 類別        | 必要設定                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| AI          | 設定 `AI_PROVIDER=gemini` 或 `openai`，並填入對應的 API key 與 model                                             |
| Web / MCP   | 替換 `MCP_API_KEY`、`POLICY_ADMIN_API_KEY`、`SANDBOX_SESSION_SECRET` 與 `VLEI_ROOT_SEED` 的 placeholder          |
| x402 wallet | 設定 `SIGNER_PROVIDER=private-key`、`IMPORTER_ADDRESS`、`IMPORTER_PRIVATE_KEY` 與非零的 `CUSTOMS_BROKER_ADDRESS` |
| Payment     | 確認 `CUSTOMS_BROKER_FEE_USDC`、付款上限、`X402_NETWORK=eip155:84532` 與 `X402_FACILITATOR_URL` 符合 Demo 環境   |

`IMPORTER_PRIVATE_KEY` 只能使用專用測試網錢包。不得把主網私鑰、正式客戶文件或真實個資放入 `.env`、`uploaded-files` 或展示素材。

### 啟動

```sh
pnpm dev
```

啟動完成後使用以下入口：

| 服務             | 位置                                 |
| ---------------- | ------------------------------------ |
| Importer Web     | `http://localhost:3000`              |
| Runtime Policy   | `http://localhost:3000/admin/policy` |
| Exporter         | `http://localhost:5173`              |
| vLEI signing API | `http://localhost:3001`              |
| Importer MCP     | `http://127.0.0.1:4020/mcp`          |
| Customs Broker   | `http://127.0.0.1:4021`              |

確認後端服務正常：

```sh
curl http://127.0.0.1:4021/health
curl http://127.0.0.1:4020/health
```

兩個端點都應回傳 HTTP 200，並分別顯示 `x402-customs-broker` 與 `x402-importer-mcp` 的 `status: ok`。

## 展示方式

### Demo 前準備

- 乾淨 clone 的 `uploaded-files` 不含文件。可先在 Exporter 建立並下載同一訂單的商業發票（I/V）、裝箱單（P/L）與 vLEI-signed DPP，再回到 Importer Web 上傳。
- 完整付款流程需要 Customs Broker、Facilitator、Base Sepolia 網路及測試錢包都可用。
- Runtime Policy 阻擋展示需要 `.env` 中設定的 `POLICY_ADMIN_API_KEY`。

Sandbox 帳號：

| 使用者  | 密碼         | 權限                         |
| ------- | ------------ | ---------------------------- |
| `alice` | `alice-demo` | 文件預檢、詢價、核准付款     |
| `bob`   | `bob-demo`   | 文件預檢、詢價，不可核准付款 |

### 主流程

1. 開啟 `http://localhost:3000`，以 `alice / alice-demo` 登入，展示角色、組織與 LEI。
2. 選擇訂單並上傳 I/V、P/L 與 vLEI-signed DPP，按「以 vLEI 授權 AI 檢查並估價」。展示簽章與簽發者 LEI 驗證、文件檢查、DPP 判定、獨立估價、`preflightId`，以及此階段尚未聯絡報關行。
3. 展示 Authorization ID 與 Signer AID，說明授權綁定 action、resource、有效期限與單次 nonce。
4. 按下詢價，閱讀報關委任書至底部後勾選同意並送出。展示委任範圍不包含付款、委任書 ID、`quoteId`、報價期限、獨立估價與 broker 報價差異，以及此時尚未付款。
5. 明確核准付款。系統會再次執行 compliance 與 Runtime Policy 檢查，通過後以 x402 支付並顯示 receipt 與 declaration 結果。
6. 在 terminal 執行 `pnpm audit:verify`，使用同一 `traceId` 對照 Web 與 Importer MCP 的 audit log，展示 hash chain 驗證結果。

### 阻擋案例（至少展示兩項）

- **角色越權**：改以 Bob 登入並完成詢價；畫面不會提供付款核准按鈕。
- **錯誤 DPP**：讓 `reduction_percent` 與 footprint／baseline 不一致後重新上傳；系統會在聯絡 broker 前阻擋流程。
- **Kill switch／付款上限**：在 `/admin/policy` 載入 policy，設為 `PAYMENT_PAUSED`，或把單筆上限調低於 `CUSTOMS_BROKER_FEE_USDC`；即使 Alice 核准，付款仍會被 server-side policy 拒絕。展示後恢復原設定。

## 第三方套件說明

| 類別                | 套件／服務                                                                                                                              | 用途與執行需求                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AI                  | `@google/genai` 或 `openai`                                                                                                             | 依 `AI_PROVIDER` 產生 Agent 回答與 tool calls；需要執行者提供對應 API key                                          |
| MCP                 | `@modelcontextprotocol/sdk`                                                                                                             | Web、Importer Agent 與 vLEI verifier 之間的 tool protocol 與 transport                                             |
| x402 / Base Sepolia | `@x402/core`、`@x402/evm`、`@x402/express`、`@x402/fetch`、`viem`                                                                       | x402 v2 `exact` challenge、EVM 簽章、Facilitator verify／settle 與測試網 USDC 支付；需要外部服務及測試資產         |
| vLEI                | `vendor/vlei-sandbox`、`@noble/curves`                                                                                                  | sandbox vLEI／KERI-style JSON 簽章、驗章與曲線運算；submodule 依其 [MIT License](vendor/vlei-sandbox/LICENSE) 使用 |
| AWS KMS（選用）     | `@aws-sdk/client-kms`                                                                                                                   | 選擇 `SIGNER_PROVIDER=aws-kms` 時提供託管 signer；需要執行者自己的 AWS 帳號與 KMS key                              |
| Web / API / build   | Next.js、React、React Router、Express、Zod、TanStack Query、Tailwind CSS、Lucide、Turborepo、TypeScript、Vitest、ESLint、Prettier、pnpm | UI、HTTP service、schema validation、client state、樣式、build、型別與測試                                         |

精確版本與 transitive dependencies 以 [`pnpm-lock.yaml`](pnpm-lock.yaml) 為準。
