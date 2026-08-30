# LuLuGuard

LuLuGuard 是一個可實際操作的進口商 AI Agent POC。它將「讀取貿易文件、文件預檢與獨立估價、向報關行詢價、人工核准、x402 支付與報關送件」拆成不可任意跳過的階段，並以 vLEI 身分授權、角色權限、執行期付款政策及可驗證稽核紀錄建立可展示的治理邊界。

其中 customs broker app 以 x402 Seller / Resource Server 提供服務，使用 Base Sepolia USDC 與 x402 v2 `exact` scheme，並委由設定的 Facilitator 驗證與結算付款。

> 本專案是競賽用 sandbox 原型，使用測試資料與 Base Sepolia 測試網。它不是正式報關、法律、稅務、碳盤查或投資建議系統。

## 交件入口

| 交件項目                                      | 連結或位置                                                               | 狀態                             |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| 程式碼 repository                             | [github.com/BULUANPAY/luluguard](https://github.com/BULUANPAY/luluguard) | 已提供                           |
| Demo Day 簡報（含「治理／信任設計說明」一頁） | **`<DEMO_DAY_SLIDES_URL>`**                                              | 提交前必須替換為可公開開啟的連結 |
| 展示影片                                      | **`<DEMO_VIDEO_URL>`**                                                   | 提交前必須替換為可公開開啟的連結 |
| 執行、展示及第三方套件說明                    | 本 README                                                                | 已提供                           |

提交前請以無痕視窗逐一開啟上列連結，確認評審不需加入組織、登入私人帳號或提出存取申請。不要保留任何 `<...>` 佔位符。

### 目前符合情況

| 驗收項目                        | 判定       | 說明                                                                                                 |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 可運作 POC 與六項治理問題       | 符合       | 有實際 UI、MCP、customs broker、x402 flow、server-side blockers、audit 及自動測試，不是純 mockup     |
| Repository                      | 符合       | 已提供 repository 連結；提交前仍須以無痕視窗確認評審可直接存取                                       |
| README                          | 符合       | 包含安裝、啟動、展示、第三方套件、測試資料及 POC 限制                                                |
| Demo Day 簡報                   | **尚缺**   | 尚未提供可公開開啟的簡報連結；必須包含一頁「治理／信任設計說明」                                     |
| 實際操作影片                    | **尚缺**   | 本作品沒有線上 Demo，必須提供影片；影片須顯示真實操作及阻擋結果，不能只有投影片                      |
| Base Sepolia 完整 live E2E 預演 | 提交前確認 | 離線自動測試不會花費測試幣；仍需用 Demo 當天的 wallet、Facilitator 與網路執行 opt-in live smoke test |

因此，程式與 README 已具備 POC 交件基礎，但在補上簡報及展示影片連結並完成 live E2E 預演前，還不能視為全部交件完成。

## POC 能展示什麼

1. 員工以 sandbox 帳號登入；不同角色具有不同的 Agent 動作權限。
2. 每個預檢、詢價或付款動作都產生短效、單次使用、綁定 action 與 resource 的 vLEI Agent Authorization。
3. Agent 讀取實際上傳的 JSON 貿易文件；預檢會自動驗證所有 vLEI envelope 的簽章、可信 root AID，以及簽發者 LEI 是否符合文件提供方，再檢查必備文件、欄位與 DPP 內容。
4. Agent 先在進口商端產生獨立估價；使用者確認前不把文件送給報關行。
5. 收到報價後，Agent 比對金額、稅率、報關行費用、收款地址與報價效期；付款前再次要求明確人工核准。
6. x402 支付受 allowlist、單筆上限、24 小時累計、每小時次數、人工核准門檻與 kill switch 約束。
7. Web 與 MCP 服務以相同 `traceId` 記錄雜湊鏈稽核事件，並對密鑰、token 與付款簽章等敏感欄位遮罩。

## BEFORE LULUGUARD ACTS

每一次會讀取訂單、對外傳送文件、詢價或付款的 Agent 行動，都必須先回答六個治理問題。一般對話不會取得受控 workflow tool；一旦進入預檢、詢價或付款，以下控制會由 Web 與 MCP server 共同強制執行，而不是只靠 prompt 約束。

此表可直接作為 Demo Day 簡報中「治理／信任設計說明」頁的內容來源。

| #   | 構面                | 提問                     | 對應機制             | LuLuGuard 程式落地與 Demo 證明                                                                                                                           |
| --- | ------------------- | ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Principal           | 代表誰？                 | vLEI 身分與角色驗證  | Session 綁定 tenant、員工、組織 LEI 與角色；受控動作另有 vLEI Agent Authorization。分別登入 Alice／Bob，展示身分及付款權限差異                           |
| 2   | Authorization       | 被授權做什麼？           | 委任範圍與權限憑證   | 簽章授權綁定 agent、action、resource、`traceId` 與訂單；詢價另需閱讀並接受只涵蓋傳檔／詢價的報關委任書。未同意委任或跨 action／resource 使用會被拒絕     |
| 3   | Tool / Action       | 可以執行哪些動作？       | 工具與資料存取控制   | 每個 workflow stage 只有專屬 tool allowlist；server 重新綁定 `orderId`、`preflightId`、`quoteId` 與 approval，受控 tool 每次 Agent run 只能呼叫一次      |
| 4   | Policy Gate         | 哪些高風險動作必須阻擋？ | 規則、門檻與人工核准 | 文件／DPP／報價 compliance gate，加上 payee allowlist、單筆／日／時限額、人工核准門檻及 `PAYMENT_PAUSED`／`DISABLED`。展示錯誤 DPP 或 kill switch 阻擋   |
| 5   | Audit Log           | 如何證明做過什麼？       | 決策、文件與操作軌跡 | Web 與 MCP 以同一 `traceId` 記錄身分、模型決策、tool、policy、broker 與付款事件；JSONL 有 hash chain 且敏感值遮罩。執行 `pnpm audit:verify` 驗證         |
| 6   | Expiry / Revocation | 何時失效或撤銷？         | 到期、撤權與即時停權 | Session 8 小時、Agent Authorization 10 分鐘且 nonce 單次、quote 預設 300 秒；角色不再授權即拒絕，管理員可即時暫停付款或停用 Agent。展示過期 quote 或停權 |

> Sandbox vLEI proof 只保存簽章時的 TEL snapshot，尚未實作 production 的即時 credential revocation 查詢；目前的即時撤權由 session／角色檢查及 runtime policy kill switch 執行。

主要實作位置：[`apps/web/lib/sandbox-auth.ts`](apps/web/lib/sandbox-auth.ts)、[`apps/web/lib/vlei-authorization.ts`](apps/web/lib/vlei-authorization.ts)、[`apps/web/lib/vlei-document-verification.ts`](apps/web/lib/vlei-document-verification.ts)、[`apps/web/app/components/letter-of-authorization.tsx`](apps/web/app/components/letter-of-authorization.tsx)、[`apps/importer-mcp/src/vlei-authorization.ts`](apps/importer-mcp/src/vlei-authorization.ts)、[`apps/importer-mcp/src/payment/policy.ts`](apps/importer-mcp/src/payment/policy.ts)、[`apps/importer-mcp/src/document-review.ts`](apps/importer-mcp/src/document-review.ts)、[`apps/customs-broker/src/app.ts`](apps/customs-broker/src/app.ts) 與 [`scripts/verify-audit-log.mjs`](scripts/verify-audit-log.mjs)。

## 系統組成

本 repository 是 pnpm + Turborepo monorepo。

```text
apps/
├── importer-mcp/          MCP server、進口流程、付款政策與 x402 signer
├── customs-broker/        x402 Seller / Resource Server
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
| Customs Broker   | `http://127.0.0.1:4021`              | x402 Seller / Resource Server  |
| MCP health       | `http://127.0.0.1:4020/health`       | Importer MCP health check      |

## 執行需求

- Node.js 24 以上；`.nvmrc` 目前指定 Node.js 26
- pnpm 11.23.0
- Python 3.8 以上，供 vLEI 簽章與驗章使用
- Git submodule `vendor/vlei-sandbox`
- Gemini 或 OpenAI API key
- 要展示詢價與付款完整 happy path 時：repository 內建 customs broker、可連線的 x402 Facilitator、專用 Base Sepolia 測試錢包、測試網 gas 與測試用 USDC

切勿把主網私鑰、正式客戶文件或真實個資放入 `.env`、`uploaded-files`、簡報或展示影片。

## 安裝與環境設定

在 repository root 執行：

```sh
nvm use
git submodule update --init --recursive
pnpm install
cp .env.example .env
```

各 app 的 dev／build／start scripts 都會讀取 repository root 的 `.env`（Next.js 使用 `scripts/load-root-env.mjs`，其餘 Node services 使用 `--env-file-if-exists`），此檔已由 Git 忽略。所有 placeholder 必須在 Demo 前替換；共用變數只需設定一次。

### Web 環境變數

在 root `.env` 設定 Web 相關變數：

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

修改 `.env` 後要重新啟動 Next.js。

### Importer MCP 環境變數

在同一份 root `.env` 設定 Importer MCP 相關變數：

| 變數群組        | 變數                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Broker          | `CUSTOMS_BROKER_API_URL`, `CUSTOMS_BROKER_ADDRESS`, `CUSTOMS_BROKER_FEE_USDC`                      |
| Importer signer | `IMPORTER_ADDRESS`, `SIGNER_PROVIDER`, `IMPORTER_PRIVATE_KEY`                                      |
| AWS KMS signer  | `AWS_PROFILE`, `AWS_REGION`, `AWS_KMS_KEY_ID`, optional `AWS_KMS_ENDPOINT`                         |
| Payment limits  | `MAX_PAYMENT_USDC`, `MAX_DAILY_PAYMENT_USDC`, `MAX_PAYMENTS_PER_HOUR`, `HUMAN_APPROVAL_ABOVE_USDC` |
| x402            | `X402_NETWORK`；範例 `eip155:84532` 為 Base Sepolia                                                |
| vLEI            | `IMPORTER_LEI`, `VLEI_ROOT_SEED`                                                                   |
| MCP server      | `MCP_HOST`, `MCP_PORT`, `MCP_API_KEY`                                                              |
| Policy admin    | `POLICY_ADMIN_API_KEY`；請勿與 `MCP_API_KEY` 共用                                                  |
| Audit / logging | `LOG_LEVEL`, `AUDIT_LOG_ENABLED`, `AUDIT_LOG_PATH`, `AUDIT_LOG_MAX_VALUE_LENGTH`                   |

本機 Demo 可用 `SIGNER_PROVIDER=private-key`，但只能放專用測試網私鑰。若要展示託管金鑰邊界，改用 `SIGNER_PROVIDER=aws-kms` 並設定 KMS 變數。

Importer MCP 會直接從 `VLEI_ROOT_SEED` 推導並驗證 root AID，不需要另外維護衍生值。

### Customs Broker 與 x402 環境變數

內建 customs broker 預設使用同一份 root `.env`：

| 變數                                         | 說明                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `CUSTOMS_BROKER_HOST`, `CUSTOMS_BROKER_PORT` | 預設 `127.0.0.1:4021`                                                    |
| `CUSTOMS_BROKER_ADDRESS`                     | 收取 USDC 的非零 EVM address，並須列在 Importer payment policy allowlist |
| `CUSTOMS_BROKER_FEE_USDC`                    | 報關服務費；Importer 與 broker 必須使用相同值                            |
| `CUSTOMS_BROKER_QUOTE_TTL_SECONDS`           | Quote 有效秒數，預設 300                                                 |
| `X402_NETWORK`                               | 此 POC 固定支援 `eip155:84532`（Base Sepolia）                           |
| `X402_FACILITATOR_URL`                       | x402 verify／settle facilitator URL；預設 `https://x402.org/facilitator` |
| `X402_FACILITATOR_TIMEOUT_MS`                | Facilitator request timeout，預設 30000 ms                               |

詢價由內建 broker 本機處理且不收費；只有 `POST /customs/declarations` 受到 x402 middleware 保護。完整付款仍會把 payment verification／settlement 送往設定的 Facilitator。

## 啟動方式

### 進口商主流程

```sh
pnpm dev
```

Turborepo 會先 build Web 所依賴的 vLEI verifier MCP 與 JSON signing package。確認 Importer MCP 正常：

```sh
curl http://127.0.0.1:4021/health
curl http://127.0.0.1:4020/health
```

預期回應分別為：

```json
{ "status": "ok", "service": "x402-customs-broker" }
```

```json
{ "status": "ok", "service": "x402-importer-mcp" }
```

### Customs Broker x402 flow

Importer workflow 的三個 MCP tools 為 `review_import_documents`、`get_import_quote` 與 `submit_import_declaration`；前者先在本地檢查文件與估價，通過使用者確認後才向 customs broker 詢價，最後才以 x402 付款送件。

Customs Broker 的 protected Seller flow 為：

```text
POST /customs/quotes
→ 200 quote
→ POST /customs/declarations
→ 402 PAYMENT-REQUIRED
→ retry with PAYMENT-SIGNATURE
→ Facilitator verify
→ prepare declaration
→ Facilitator settle
→ 200 + PAYMENT-RESPONSE + receipt
```

Declaration response 會等 settlement 成功後才回傳；verification 或 settlement 失敗時不會回傳成功的 filing receipt。

也可以分別啟動：

```sh
pnpm --filter @luluguard/importer-mcp dev
pnpm --filter @luluguard/web dev
pnpm --filter @luluguard/customs-broker dev
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

乾淨 clone 的 `uploaded-files` 不含業務資料。預檢最低需要同一 `orderId` 的商業發票與裝箱單；為展示資料信任機制，建議另外加入 vLEI-signed DPP，海運提單則為選用。Exporter Demo 可製作 I/V、P/L 與 DPP。報關委任書不需預先上傳，系統會在使用者確認估價並同意傳檔詢價時建立，並附上該次 vLEI Agent Authorization 證據。完整付款另需確認內建 broker、Facilitator 與 Base Sepolia 測試錢包可用。

### 主流程（約 6 分鐘）

1. 開啟 `http://localhost:3000`，以 `alice / alice-demo` 登入，指出畫面上的角色、組織與 LEI。
2. 選擇訂單並上傳 I/V、P/L 與 vLEI-signed DPP。按「以 vLEI 授權 AI 檢查並估價」。展示自動驗章、簽發者 LEI 比對、文件檢查、DPP 低碳判定、獨立估價、`preflightId`，以及「尚未聯絡報關行」。
3. 展示 Authorization ID 與 Signer AID，說明 action、resource、有效期限與 nonce 都受簽章保護。
4. 按下詢價後閱讀報關委任書至底部，勾選同意並送出。展示委任範圍不包含付款、委任書 ID、`quoteId`、報價有效期限、獨立估價與 broker 報價差異，以及尚未付款。
5. 按下付款核准。系統重新執行 policy 與 compliance checks，透過 x402 支付後顯示 receipt／declaration 結果。
6. 在 terminal 執行 `pnpm audit:verify`，以同一 `traceId` 對照 Web 與 Importer MCP audit log。

### 阻擋案例（約 3 分鐘，至少選兩項）

- **角色越權**：以 Bob 登入；取得報價後不會出現付款按鈕。
- **資料不一致**：把 DPP 的 `reduction_percent` 改成與 footprint／baseline 不一致，重新上傳與預檢；系統會在聯絡 broker 前阻擋。
- **錯誤簽發者**：用非訂單出口商 LEI 簽署 I/V、P/L 或 DPP；預檢會指出預期與實際 LEI，且不使用未通過驗證的 payload。
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
   - 需要通過 preflight、使用者明確確認估價並接受本訂單報關委任書，才把文件與附有 vLEI Authorization reference 的委任紀錄送給 broker。
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

若 dispatched payment 無法確認，Importer 會記錄 `ambiguous` 或 `pending` reconciliation 並阻擋自動重試；可用 policy-admin 保護的 `GET /admin/reconciliation/:quoteId` 與 `POST /admin/reconciliation/resolve` 查詢及處理。只有 operator 確認的 terminal failure 才能釋放付款，且 attempts、network、payer、amount 與已記錄的 transaction hash 必須相符。

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

Customs Broker 測試預設離線執行；opt-in live smoke test 需要有資金的 Base Sepolia 測試錢包：

```sh
X402_LIVE_TEST=1 node --env-file=.env --import tsx --test apps/customs-broker/test/live.test.ts
```

一般 `pnpm test` 不會送出鏈上交易；live smoke test 只有在明確設定 `X402_LIVE_TEST=1` 且 wallet／address 格式有效時才會執行。

測試涵蓋缺件與 DPP 錯誤、文件簽發者 LEI、報關委任同意、預估確認、報價效期、人工核准、支付限額、錯誤收款地址、並行重複付款、vLEI action／resource mismatch、過期、nonce replay、x402 challenge、settlement 與 ambiguous reconciliation。Importer 的 broker fetch 使用可重現 stub；customs broker 另有實際 HTTP middleware 測試，UI happy path 預設連到 repository 內建 broker。

Production build 後，在不同 terminal 啟動：

```sh
pnpm build
pnpm --filter @luluguard/importer-mcp start
```

```sh
pnpm --filter @luluguard/web start
```

```sh
pnpm --filter @luluguard/customs-broker start
```

## 第三方套件、服務與素材揭露

| 類別               | 套件／服務                                                                  | 用途與揭露                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AI model           | `@google/genai` 或 `openai`                                                 | 依 `AI_PROVIDER` 擇一產生 Agent 回答與 tool calls；需要使用者自己的 API key，輸出可能非決定性                                                |
| Agent protocol     | `@modelcontextprotocol/sdk`                                                 | Web 與 Importer／Verifier tools 之間的 MCP transport                                                                                         |
| Payment            | `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch`, `viem`           | Importer buyer、broker resource server、x402 v2 `exact` challenge、EVM 簽章與 Base Sepolia 測試交易                                          |
| Payment service    | 設定於 `X402_FACILITATOR_URL` 的 x402 Facilitator                           | 外部 verify／settle 服務；可用性、資料處理與服務條款由該 Facilitator 提供者負責                                                              |
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
- Broker 已包含在 repository；完整付款仍依賴外部 x402 Facilitator、Base Sepolia RPC／網路及測試資產可用性。Demo 前應做 end-to-end 預演並準備真實操作錄影作為網路故障備援。
- Customs quotes 與 declarations 是 mock 資料，不代表真實政府或報關整合；目前僅支援 Base Sepolia USDC 的 x402 v2 `exact` scheme。
- Ambiguous settlement outcome 會 fail closed 並需要人工處理；replay protection、ownership lock 與 reconciliation 目前是 process-local。
