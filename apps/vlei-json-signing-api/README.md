# @repo/vlei-json-signing-api

一個薄薄的 HTTP API，包裝 `@repo/vlei-json-signing` 套件的 `signJson`，
讓外部服務可以透過 REST 呼叫來取得已簽章的 JSON envelope。

## 環境變數

- `VLEI_SIGNING_API_PORT`：服務監聽的埠號，預設 `3001`
- `VLEI_ROOT_SEED`：根金鑰種子（由 `@repo/vlei-json-signing` 內部讀取）

## 開發

```bash
pnpm --filter @repo/vlei-json-signing-api dev
```

## API

### `GET /health`

回傳 `{ "status": "ok" }`，用於健康檢查。

### `POST /api/sign`

請求 body 只需要 signer 的內容資訊，不需要提供 id、也不需要事先呼叫
`createSigner()`：

```json
{
  "signerInfo": { "name": "LuLuGuard Test Signer", "role": "Integration Test" },
  "lei": "8755001ELOZEL05BVX22",
  "payload": { "message": "Hello, world!" }
}
```

signer id 會由 API 內部根據 `signerInfo` 的 canonical JSON 雜湊自動衍生
（`signer-<sha256 前綴>`），因此完全相同的 `signerInfo` 永遠對應同一個
signer（等同重複呼叫 `createSigner()`），不同的 `signerInfo` 則會產生不同
signer。回應會在簽章後的 `SignedJsonEnvelope` 之外多帶一個 `signerId` 欄位，
方便呼叫端記錄。

成功時回傳簽章後的 `SignedJsonEnvelope`（HTTP 200）。
失敗時回傳 `{ "error": { "code": string, "message": string } }`
（HTTP 400 為驗證/簽章錯誤，HTTP 500 為未預期的錯誤）。
