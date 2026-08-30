# 訂單文件儲存規範

本文件定義 LuLuGuard repo 內的訂單文件儲存方式。未來的獨立前端與其上傳服務應直接實作這份 storage contract，不依賴 `apps/web` 的頁面或 API。

## 儲存位置

所有上傳文件都放在 repo root 的 `uploaded-files` 目錄。此名稱代表執行期間產生的上傳檔案，不會與 `docs` 等專案說明文件混淆：

```text
uploaded-files/
└── <order-id>/
    └── <original-name>-<uuid>.json
```

例如：

```text
uploaded-files/ORD-1001/invoice-550e8400-e29b-41d4-a716-446655440000.json
```

每一層的用途：

- `<order-id>`：文件所屬的訂單編號。
- `<original-name>-<uuid>.json`：可辨識的原始檔名片段加 UUID；UUID 用來避免同名檔案互相覆蓋。

## 文件類型

上傳時不要求使用者選擇文件類型。AI Agent 讀取內容後，可判斷為下列預設類型：

- `commercial_invoice`
- `packing_list`
- `bill_of_lading`
- `certificate_of_origin`
- `product_specification`
- `import_permit`

既有的類型資料夾仍可讀取，以相容舊資料；新上傳一律直接寫入訂單目錄。

## 寫入規則

任何負責接收文件的服務都必須遵守以下規則：

1. 僅接受 `.json` 檔案，且在寫入前必須實際解析 JSON，不能只檢查副檔名或 MIME type。
2. `order-id` 必須符合 `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`，禁止 `/`、`..` 或其他可改變路徑的內容。
3. 原始檔名必須先取 basename、移除副檔名，再將非英數、`-`、`_` 的字元轉成 `-`；建議最多保留 80 個字元。
4. 儲存檔名必須附加 UUID，並用「檔案已存在即失敗」的寫入模式，禁止默默覆蓋現有文件。
5. 一批多檔上傳必須先完成整批驗證，再開始寫入。任一檔案無效時，該批不得寫入任何檔案。
6. 建議先寫入同一 filesystem 的暫存檔，再以 atomic rename 移入目標路徑，避免程序中斷後留下不完整文件。
7. 寫入完成後應回報 repo-relative path，例如 `uploaded-files/ORD-1001/invoice-<uuid>.json`；資料庫若需建立索引，也應儲存這個相對路徑，而不是機器相關的 absolute path。

## 讀取與列舉

新文件的身份由「訂單編號、儲存檔名」組成。讀取服務應從已驗證的 segment 組合路徑，並再次確認 resolve 後的路徑仍位於 repo root 的 `uploaded-files` 之下。

列舉文件時依序掃描：

```text
uploaded-files/<order-id>/*.json
```

為相容舊資料，讀取器也會掃描 `uploaded-files/<order-id>/<document-type>/*.json`。

應忽略隱藏檔、暫存檔及非 `.json` 檔案。不得將目錄名稱或檔案內容視為可信輸入。

### MCP consumer

Importer MCP 提供唯讀的 `get_order_files` tool，讓 Agent 以 `orderId` 取得文件。tool 會回傳每個檔案的分類狀態、檔名、repo-relative path、大小及解析後的 JSON 內容；Agent 應根據內容判斷新文件的實際類型。

`apps/web` Agent 已開放此 tool，並固定以頁面目前選取的訂單編號呼叫，避免模型自行指定其他訂單。未來其他 consumer 也應透過 MCP 或等效的受控讀取層存取，不應讓模型直接操作 filesystem path。

## 刪除與更新

上傳採 append-only：新版本應產生新的 UUID 檔名，不直接覆寫舊檔。若產品未來需要版本關係，應由獨立 metadata/index 記錄新舊版本，不改變上述實體路徑結構。

刪除屬於破壞性操作，必須由具權限的後端服務執行並保留 audit log；前端不得直接組合 filesystem path 執行刪除。

## 執行環境

這個設計假設上傳服務能寫入同一份 repo checkout，適合本機開發、內部伺服器或掛載持久化磁碟的環境。瀏覽器前端本身不能直接寫入 repo，未來獨立頁面仍需要自己的後端或受控的本機服務來執行上述規則。

若部署環境使用唯讀或 ephemeral filesystem，應改用持久化 volume 或 object storage；即使底層儲存改變，仍建議保留 `<order-id>/<filename>` 這個 key 結構。

## Git 追蹤

`uploaded-files` 是 runtime data，不屬於原始碼。repo 的 `.gitignore` 會忽略此目錄下的上傳內容，只追蹤 `uploaded-files/.gitkeep` 以保留目錄骨架。若需要交換測試 fixture，應另外放在明確的 test fixture 目錄，不要強制加入實際上傳檔案。
