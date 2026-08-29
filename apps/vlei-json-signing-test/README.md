# vLEI JSON signing test

這個 TypeScript smoke-test app 會：

1. 從 `VLEI_ROOT_SEED` 建立 root AID。
2. 建立 `test-signer` 及其 root-signed credential。
3. 簽署範例 JSON。
4. 使用公開的 root AID 驗證 envelope。
5. 比對原始 JSON 與驗證後取得的 signer info。

可直接執行：

```sh
pnpm --filter @repo/vlei-json-signing-test test-vlei
```

也可驗證 script 內既有的 envelope。這個流程使用 static `verifyJson()`，只需要
預期的 root AID，不讀取 `VLEI_ROOT_SEED` 或 signing state：

```sh
pnpm --filter @repo/vlei-json-signing-test test-vlei-verify
```

若未設定 `VLEI_ROOT_SEED`，script 會顯示警告並使用固定的本機 smoke-test-only
seed；這個 fallback 不可用於正式環境。LEI 由 script 在呼叫 `signJson` 時帶入。
Script 會自動載入 repository root 的 `.env`。若尚未建立，可從範例建立：

```sh
cp .env.example .env
```

將其中的 placeholder 換成秘密字串，再執行相同指令。

簽章 state 由 `@repo/vlei-json-signing` 統一管理，固定寫入該 package 內的
`.vlei-json-signing/`，並會沿用前一次測試狀態。
