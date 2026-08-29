# vLEI JSON Verify MCP

透過 MCP tool 呼叫 `@repo/vlei-json-signing` 的 static `verifyJson()` method，驗證
自包含的 vLEI-signed JSON envelope。服務採用 stdio transport，不需要 root seed 或
signing state。

## Requirements

- Node.js 24+
- Python 3.8+
- 已初始化 `vendor/vlei-sandbox` submodule

## Build

```sh
pnpm --filter @luluguard/vlei-json-verify-mcp... build
```

## MCP client configuration

從 repository root 啟動：

```json
{
  "mcpServers": {
    "vlei-json-verify": {
      "command": "pnpm",
      "args": [
        "--filter",
        "@luluguard/vlei-json-verify-mcp",
        "start"
      ],
      "cwd": "/absolute/path/to/luluguard"
    }
  }
}
```

上述 MCP client 設定需先完成 build。開發時可將 `start` 改為 `dev`；首次執行前仍需
先 build workspace dependency `@repo/vlei-json-signing`。

## Tool

### `verify_vlei_json`

輸入：

- `envelope`: 完整的 vLEI-signed JSON envelope
- `expectedRootAid`: 呼叫端信任的 root AID
- `expectedLei`: 可選；限制 envelope 必須屬於指定 LEI

簽章有效時，結果包含 `valid: true`、原始 `payload`、signer、root AID、LEI 與
簽署時間。簽章或 trust chain 無效時，結果為 `valid: false` 與具體 `errors`；Python
bridge 無法執行等服務錯誤則回傳 MCP tool error。
