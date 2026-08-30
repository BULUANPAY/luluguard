# LuLuGuard

LuLuGuard 是一個可實際操作的進口商 AI Agent POC。它將「讀取貿易文件、文件預檢與獨立估價、向報關行詢價、人工核准、x402 支付與報關送件」拆成不可任意跳過的階段，並以 vLEI 身分授權、角色權限、執行期付款政策及可驗證稽核紀錄建立可展示的治理邊界。

> 本專案是競賽用 sandbox 原型，使用測試資料與 Base Sepolia 測試網。它不是正式報關、法律、稅務、碳盤查或投資建議系統。

## 交件入口

| 交件項目                                      | 連結或位置                                                               | 狀態                                         |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| 程式碼 repository                             | [github.com/BULUANPAY/luluguard](https://github.com/BULUANPAY/luluguard) | 已提供                                       |
| Demo Day 簡報（含「治理／信任設計說明」一頁） | **`<DEMO_DAY_SLIDES_URL>`**                                              | 提交前必須替換為可公開開啟的連結             |
| 線上 Demo                                     | **`<LIVE_DEMO_URL>`**                                                    | 若無線上環境，請刪除此列                     |
| 展示影片                                      | **`<DEMO_VIDEO_URL>`**                                                   | 線上 Demo 與影片至少提供一項；提交前必須替換 |
| 執行、展示及第三方套件說明                    | 本 README                                                                | 已提供                                       |

提交前請以無痕視窗逐一開啟上列連結，確認評審不需加入組織、登入私人帳號或提出存取申請。不要保留任何 `<...>` 佔位符。

## POC 能展示什麼

1. 員工以 sandbox 帳號登入；不同角色具有不同的 Agent 動作權限。
2. 每個預檢、詢價或付款動作都產生短效、單次使用、綁定 action 與 resource 的 vLEI Agent Authorization。
3. Agent 讀取實際上傳的 JSON 貿易文件，檢查必備文件與欄位，並驗證 DPP 產品／批次、碳足跡計算、第三方查證資料及有效期限。
4. Agent 先在進口商端產生獨立估價；使用者確認前不把文件送給報關行。
5. 收到報價後，Agent 比對金額、稅率、報關行費用、收款地址與報價效期；付款前再次要求明確人工核准。
6. x402 支付受 allowlist、單筆上限、24 小時累計、每小時次數、人工核准門檻與 kill switch 約束。
7. Web 與 MCP 服務以相同 `traceId` 記錄雜湊鏈稽核事件，並對密鑰、token 與付款簽章等敏感欄位遮罩。

## 六項治理／信任機制

此表可直接作為 Demo Day 簡報中「治理／信任設計說明」頁的內容來源。

| #   | 信任機制                 | 實際控制                                                                                                                                          | Demo 現場如何證明                                                                |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | 可驗證的組織與人員身分   | 員工 session 綁定 tenant、LEI、員工與角色；每次受控動作另外簽發 vLEI Agent Authorization                                                          | 分別登入 Alice 與 Bob，畫面顯示組織、LEI、角色及可用動作                         |
| 2   | 最小權限與可驗證委任     | 授權綁定 `agentId`、版本、action、resource、`traceId`、有效期限與 nonce；MCP 端驗章、比對可信 root AID／LEI，並拒絕跨動作、跨資源、過期或重放授權 | Bob 可預檢與詢價但不能付款；成功動作會顯示 Authorization ID、Signer AID          |
| 3   | 資料完整性與合規前置檢查 | 可用 vLEI verifier 驗證出口文件 envelope；預檢會阻擋缺件、欄位矛盾、無效 DPP、產品／批次不一致或碳減量計算不一致的資料                            | 上傳正確文件可通過；把 DPP 減量百分比改錯後重新預檢，系統在傳送報關行前阻擋      |
| 4   | 分階段揭露與人類決策點   | 固定流程為預檢 → 明確確認預估 → 詢價 → 明確核准付款；不能跳過階段，報價有時效且只能成功使用一次                                                   | 預檢結果明示尚未聯絡報關行；未確認預估不能詢價，未核准付款不能送件               |
| 5   | 可程式化的資金治理       | x402 支付前重新檢查 Agent 狀態、收款 allowlist、單筆／日／時限額、人工核准門檻、報價與 compliance blocker；可選 private key 或 AWS KMS signer     | 在 Policy 頁按「暫停所有付款」後嘗試支付會被拒絕；恢復 `ACTIVE` 後才可依政策執行 |
| 6   | 全鏈路可歸責與可稽核性   | Web、模型工具決策、MCP、政策判斷、broker 與付款事件以 `traceId` 串接；JSONL 使用 `previousHash`／`hash` 形成防竄改雜湊鏈，並遮罩敏感資料          | 完成一輪操作後執行 `pnpm audit:verify`，再用同一 `traceId` 對照兩個 audit log    |

主要實作位置：[`apps/web/lib/sandbox-auth.ts`](apps/web/lib/sandbox-auth.ts)、[`apps/web/lib/vlei-authorization.ts`](apps/web/lib/vlei-authorization.ts)、[`apps/importer-mcp/src/vlei-authorization.ts`](apps/importer-mcp/src/vlei-authorization.ts)、[`apps/importer-mcp/src/payment/policy.ts`](apps/importer-mcp/src/payment/policy.ts)、[`apps/importer-mcp/src/document-review.ts`](apps/importer-mcp/src/document-review.ts) 與 [`scripts/verify-audit-log.mjs`](scripts/verify-audit-log.mjs)。

## 系統組成

本 repository 是 pnpm + Turborepo monorepo。

```text
apps/
├── importer-mcp/          MCP server、進口流程、付款政策與 x402 signer
├── exporter/              React Router 出口文件製作與簽章 Demo
├── vlei-json-signing-api/ 瀏覽器可呼叫的 JSON 簽章服務
├── vlei-json-signing-test/簽章及驗章 smoke tests
├── vlei-json-verify-mcp/  vLEI signed JSON 驗證 MCP
└── web/                   Next.js Agent UI、文件上傳與 Policy 管理頁
packages/
├── api-client/            OpenAPI 產生的 client
├── eslint-config/         共用 ESLint 設定
├── shared/                共用 domain constants
├── typescript-config/     共用 TypeScript 設定
├── ui/                    共用 React UI
└── vlei-json-signing/     TypeScript API 與 Python vLEI bridge
```

| 應用程式         | 預設位置                             | 用途                           |
| ---------------- | ------------------------------------ | ------------------------------ |
| Web              | `http://localhost:3000`              | 進口工作流、AI 對話與文件上傳  |
| Policy admin     | `http://localhost:3000/admin/policy` | 執行期付款政策與 kill switch   |
| Exporter         | `http://localhost:5173`              | I/V、P/L、DPP 製作與 vLEI 簽章 |
| vLEI signing API | `http://localhost:3001`              | JSON 簽章 HTTP API             |
| Importer MCP     | `http://127.0.0.1:4020/mcp`          | Streamable HTTP MCP endpoint   |
| MCP health       | `http://127.0.0.1:4020/health`       | Importer MCP health check      |

## 執行需求

- Node.js 24 以上；`.nvmrc` 目前指定 Node.js 26
- pnpm 11.23.0
- Python 3.8 以上，供 vLEI 簽章與驗章使用
- Git submodule `vendor/vlei-sandbox`
- Gemini 或 OpenAI API key
- 要展示詢價與付款完整 happy path 時：相容的 customs broker API、專用 Base Sepolia 測試錢包、測試網 gas 與測試用 USDC

切勿把主網私鑰、正式客戶文件或真實個資放入 `.env`、`uploaded-files`、簡報或展示影片。

## 安裝與環境設定

在 repository root 執行：

```sh
nvm use
git submodule update --init --recursive
pnpm install
cp apps/importer-mcp/.env.example apps/importer-mcp/.env
cp apps/web/.env.local.example apps/web/.env.local
```

兩個產生的環境檔都已由 Git 忽略。所有 placeholder 必須在 Demo 前替換；Web 與 Importer MCP 的 `MCP_API_KEY` 必須完全相同。

### Web 環境變數

設定 `apps/web/.env.local`：

| 變數                             | 說明                                           |
| -------------------------------- | ---------------------------------------------- |
| `AI_PROVIDER`                    | `gemini` 或 `openai`                           |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | 使用 Gemini 時需要                             |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | 使用 OpenAI 時需要                             |
| `MCP_SERVER_URL`                 | 通常是 `http://127.0.0.1:4020/mcp`             |
| `MCP_API_KEY`                    | 必須與 Importer MCP 相同                       |
| `SANDBOX_SESSION_SECRET`         | session HMAC secret；production 至少 32 字元   |
| `VLEI_ROOT_SEED`                 | sandbox vLEI root seed；只放秘密環境，不得提交 |
| `VLEI_VERIFY_MCP_*`              | 可選的 verifier command、args 與 cwd override  |
| `AUDIT_LOG_*`                    | audit 開關、路徑與單一值長度上限               |

修改 `.env.local` 後要重新啟動 Next.js。

### Importer MCP 環境變數

設定 `apps/importer-mcp/.env`：

| 變數群組        | 變數                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Broker          | `CUSTOMS_BROKER_API_URL`, `CUSTOMS_BROKER_ADDRESS`, `CUSTOMS_BROKER_FEE_USDC`                      |
| Importer signer | `IMPORTER_ADDRESS`, `SIGNER_PROVIDER`, `IMPORTER_PRIVATE_KEY`                                      |
| AWS KMS signer  | `AWS_PROFILE`, `AWS_REGION`, `AWS_KMS_KEY_ID`, optional `AWS_KMS_ENDPOINT`                         |
| Payment limits  | `MAX_PAYMENT_USDC`, `MAX_DAILY_PAYMENT_USDC`, `MAX_PAYMENTS_PER_HOUR`, `HUMAN_APPROVAL_ABOVE_USDC` |
| x402            | `X402_NETWORK`；範例 `eip155:84532` 為 Base Sepolia                                                |
| vLEI            | `IMPORTER_LEI`, `VLEI_EXPECTED_ROOT_AID`                                                           |
| MCP server      | `MCP_HOST`, `MCP_PORT`, `MCP_API_KEY`                                                              |
| Policy admin    | `POLICY_ADMIN_API_KEY`；請勿與 `MCP_API_KEY` 共用                                                  |
| Audit / logging | `LOG_LEVEL`, `AUDIT_LOG_ENABLED`, `AUDIT_LOG_PATH`, `AUDIT_LOG_MAX_VALUE_LENGTH`                   |

本機 Demo 可用 `SIGNER_PROVIDER=private-key`，但只能放專用測試網私鑰。若要展示託管金鑰邊界，改用 `SIGNER_PROVIDER=aws-kms` 並設定 KMS 變數。

`VLEI_EXPECTED_ROOT_AID` 必須由 Web 所使用的同一個 `VLEI_ROOT_SEED` 推導。先 build package，再於已設定該環境變數的 shell 中執行：

```sh
pnpm --filter @repo/vlei-json-signing build
node --input-type=module -e 'import { VleiJsonSigning } from "./packages/vlei-json-signing/dist/index.js"; console.log(await VleiJsonSigning.deriveRootAid(process.env.VLEI_ROOT_SEED));'
```

將輸出值填入 `apps/importer-mcp/.env` 的 `VLEI_EXPECTED_ROOT_AID`，不要把 seed 填進該欄位。

## 啟動方式

### 進口商主流程

```sh
pnpm dev
```

Turborepo 會先 build Web 所依賴的 vLEI verifier MCP 與 JSON signing package。確認 Importer MCP 正常：

```sh
curl http://127.0.0.1:4020/health
```

預期回應：

```json
{ "status": "ok", "service": "x402-importer-mcp" }
```

也可以分別啟動：

```sh
pnpm --filter @luluguard/importer-mcp dev
pnpm --filter @luluguard/web dev
```

### 出口文件簽章 Demo

在兩個 terminal 分別啟動：

```sh
pnpm dev:vlei-signing-api
pnpm dev:exporter
```

Exporter 預設向 `http://localhost:3001` 簽章；可用 `VITE_VLEI_SIGNING_API_URL` 改寫。`VITE_VLEI_SIGNING_LEI` 必須是有效的 ISO 17442 LEI。`VLEI_SIGNING_ALLOWED_ORIGIN` 可限制 signing API 的 browser origin，預設為 `http://localhost:5173`。

### Sandbox 帳號

| 使用者  | 密碼         | 角色／權限                                         |
| ------- | ------------ | -------------------------------------------------- |
| `alice` | `alice-demo` | Import Operations Manager；預檢、詢價、付款        |
| `bob`   | `bob-demo`   | Import Operations Specialist；預檢、詢價，不可付款 |

帳密硬編碼只為現場展示角色差異，不可用於 production。

## Demo Day 展示腳本

建議先準備一組屬於同一 `orderId` 的測試 JSON：商業發票、裝箱單、海運提單與 DPP。乾淨 clone 的 `uploaded-files` 不含業務資料；可由 Exporter Demo 製作 I/V、P/L、DPP，再準備相同訂單的測試提單。完整詢價／付款另需預先確認 broker API 與 Base Sepolia 測試錢包可用。

### 主流程（約 6 分鐘）

1. 開啟 `http://localhost:3000`，以 `alice / alice-demo` 登入，指出畫面上的角色、組織與 LEI。
2. 選擇訂單並上傳四份 JSON。按「以 vLEI 授權 AI 檢查並估價」。展示文件檢查、DPP 低碳判定、獨立估價、`preflightId`，以及「尚未聯絡報關行」。
3. 展示 Authorization ID 與 Signer AID，說明 action、resource、有效期限與 nonce 都受簽章保護。
4. 明確確認預估後詢價。展示 `quoteId`、報價有效期限、獨立估價與 broker 報價差異，以及尚未付款。
5. 按下付款核准。系統重新執行 policy 與 compliance checks，透過 x402 支付後顯示 receipt／declaration 結果。
6. 在 terminal 執行 `pnpm audit:verify`，以同一 `traceId` 對照 Web 與 Importer MCP audit log。

### 阻擋案例（約 3 分鐘，至少選兩項）

- **角色越權**：以 Bob 登入；取得報價後不會出現付款按鈕。
- **資料不一致**：把 DPP 的 `reduction_percent` 改成與 footprint／baseline 不一致，重新上傳與預檢；系統會在聯絡 broker 前阻擋。
- **人工決策點**：不確認獨立估價就無法詢價；不明確核准付款就無法呼叫 paid tool。
- **Kill switch**：在 `/admin/policy` 載入 policy，設為 `PAYMENT_PAUSED`；即使 Alice 核准，付款仍被 server-side policy 拒絕。展示後恢復 `ACTIVE`。
- **支付邊界**：把單筆上限調低於 `CUSTOMS_BROKER_FEE_USDC`，展示 `PER_PAYMENT_LIMIT_EXCEEDED`。
- **防重放／重複付款**：同一授權 nonce 或同一已使用 quote 不能再次成功提交。

Demo 前應錄製一份備援影片，但影片必須展示真實操作、阻擋結果與 audit 驗證，而不是只有投影片或 mockup。

## 工作流與安全邊界

Importer Agent 暴露四個 MCP tools：

1. `get_order_files`
   - 讀取 `uploaded-files/<order-id>/` 的 JSON，不聯絡 broker、不付款。
2. `review_import_documents`
   - 檢查必備文件與 DPP，產生進口商獨立估價及 `preflightId`。
   - DPP 至少 20% 經驗證減量才歸類為本 Demo policy 的低碳產品；低於門檻為 warning，無效 DPP 則阻擋傳送。
3. `get_import_quote`
   - 需要通過 preflight 且使用者明確確認估價，才把文件送給 broker。
   - 比對獨立估價、broker quote 與 compliance findings，回傳 `quoteId`，但不付款。
4. `submit_import_declaration`
   - 需要相符、已審查且未過期的 quote，並重新檢查 compliance 與執行期付款政策。
   - 依門檻要求人工核准，使用 x402 付款後才送出 DPP 與低碳評估。

Agent 可因狀態、收款 allowlist、單筆上限、rolling 24-hour limit、每小時次數、缺少人工核准、quote 過期、文件／DPP 錯誤或 compliance blocker 而拒絕執行。

## Runtime Policy 管理

開啟 `http://localhost:3000/admin/policy`，輸入 `POLICY_ADMIN_API_KEY` 後載入 policy。管理頁可以：

- 將 Agent 設為 `ACTIVE`、`PAYMENT_PAUSED` 或 `DISABLED`；
- 更新單筆、24 小時累計、每小時次數及人工核准門檻；
- 更新允許的 broker addresses；
- 顯示目前 Importer MCP process 內的成功付款筆數與金額。

Web proxy 使用 `GET /admin/policy` 與 `PUT /admin/policy`。Policy、preflight、quote 與 payment history 目前存在記憶體，Importer MCP 重啟後會清除。

## Audit log

預設產生 append-only JSON Lines：

- `apps/web/logs/audit.jsonl`：登入、chat、模型 request／response、tool decision 與 MCP client interaction。
- `apps/importer-mcp/logs/audit.jsonl`：MCP HTTP、tool execution、workflow decision、vLEI 驗證、policy、broker 與 x402 interaction。

Web 以 `x-audit-trace-id` 傳遞 `traceId` 到 MCP。每筆紀錄包含 `previousHash` 與 `hash`，可執行：

```sh
pnpm audit:verify
```

Authorization、API key、private key、secret、password、cookie、token 與 payment signature 會遮罩；長值依 `AUDIT_LOG_MAX_VALUE_LENGTH` 截斷。Audit 檔已由 Git 忽略；production 應送往有存取控制與保留政策的 durable storage。

## 驗證方式

從 repository root 執行完整檢查：

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

只驗證 Importer 的工作流、DPP、付款政策與授權：

```sh
pnpm --filter @luluguard/importer-mcp test
```

測試涵蓋缺件與 DPP 錯誤阻擋、預估確認、報價效期、人工核准、支付限額、錯誤收款地址、並行重複付款、vLEI action／resource mismatch、過期與 nonce replay 等案例。測試中的 broker 與 paid fetch 是可重現的 stub；UI happy path 則使用環境變數指定的 broker API。

Production build 後，在不同 terminal 啟動：

```sh
pnpm build
pnpm --filter @luluguard/importer-mcp start
```

```sh
pnpm --filter @luluguard/web start
```

## 第三方套件、服務與素材揭露

| 類別               | 套件／服務                                                                  | 用途與揭露                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AI model           | `@google/genai` 或 `openai`                                                 | 依 `AI_PROVIDER` 擇一產生 Agent 回答與 tool calls；需要使用者自己的 API key，輸出可能非決定性                                                |
| Agent protocol     | `@modelcontextprotocol/sdk`                                                 | Web 與 Importer／Verifier tools 之間的 MCP transport                                                                                         |
| Payment            | `@x402/core`, `@x402/evm`, `@x402/fetch`, `viem`                            | x402 payment negotiation、EVM 簽章與 Base Sepolia 測試交易                                                                                   |
| Identity / signing | `vendor/vlei-sandbox`, `@noble/curves`                                      | sandbox vLEI／KERI-style JSON signing、驗章與曲線運算；`vlei-sandbox` 為 Git submodule，依其 [MIT License](vendor/vlei-sandbox/LICENSE) 使用 |
| Managed key option | `@aws-sdk/client-kms`                                                       | 選用 AWS KMS 時的 signer backend；AWS 帳號與費用由執行者負擔                                                                                 |
| Web / API          | Next.js、React、React Router、Express、Zod、TanStack Query                  | UI、HTTP service、schema validation 與 client state                                                                                          |
| UI / build / test  | Tailwind CSS、Lucide、Turborepo、TypeScript、Vitest、ESLint、Prettier、pnpm | 樣式、圖示、monorepo build、型別、測試與格式化                                                                                               |
| 測試資料           | Repository 內程式化 fixtures 與使用者自行上傳的 Demo JSON                   | 名稱、訂單、LEI、DPP 與金額只供 POC；不得視為真實交易或官方資料                                                                              |

精確版本與 transitive dependencies 以 [`pnpm-lock.yaml`](pnpm-lock.yaml) 為準；各 dependency 的著作權與授權條款仍以其上游套件為準。本 repository 內直接 vendor 的第三方原始碼為 `vendor/vlei-sandbox`，其授權檔隨原始碼保留。若簡報或影片另外加入字型、圖示、照片、音樂、商標或資料集，必須在交件前另行列出來源與授權；本 README 不替未納入 repository 的素材背書。

## POC 限制與 production 前工作

- vLEI 使用 sandbox mock engine；envelope 內 TEL 是簽章時快照，不能取代 production KERIA、witness、OOBI、IPEX 或即時撤銷查詢。
- 目前員工帳密是 Demo fixture，session 是 HMAC cookie；production 必須串接 IdP／SSO、MFA、正式 HR／role lifecycle 與撤銷機制。
- 稅則、進口費用與 20% 低碳門檻是本地 Demo policy，不是官方稅則核定、法規判斷或正式碳查證。
- Policy、preflight、quote、nonce replay guard 與 payment history 主要在記憶體；production 必須使用 durable、具 concurrency control 的儲存。
- 本機 JSONL 可偵測鏈內竄改，但不是 WORM storage；production 應外送 SIEM／immutable storage、簽署 checkpoint 並建立 retention policy。
- `uploaded-files` 是本機 POC 儲存；production 必須加入物件儲存、加密、惡意檔案掃描、tenant isolation、資料保留與刪除流程。
- 完整付款依賴外部 broker 的 x402 相容性及測試網可用性；Demo 前應做 end-to-end 預演並準備真實操作錄影作為網路故障備援。
