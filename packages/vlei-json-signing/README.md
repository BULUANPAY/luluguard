# @repo/vlei-json-signing

使用 repository 內的 `vlei-sandbox`，建立由固定 root AID 授權的 JSON
簽章者，並產生可離線驗證的自包含 JSON envelope。

> 此 package 使用 sandbox mock engine。證明中的 TEL 是簽章時的快照，並不
> 取代 production KERIA、witness、OOBI、IPEX 或即時撤銷查詢。

## Requirements

- Node.js 24+
- Python 3.8+
- 已初始化 `vendor/vlei-sandbox` submodule：

```sh
git submodule update --init --recursive
```

## Root seed

`VLEI_ROOT_SEED` 接受任意長度的非空 UTF-8 字串。Package 會使用
domain-separated HKDF-SHA256 衍生成 Ed25519 current/next seeds；相同字串永遠
產生相同 root AID。建議仍使用高熵隨機字串，例如：

```sh
openssl rand -base64 48
```

若字串包含空白或 shell 特殊字元，請在環境設定中正確引用；字串的每個字元都會
影響最終 root AID。

Seed 只應存在秘密管理系統或環境變數，不會寫入 package state 或簽章 envelope。
預設 state 位於 `.vlei-json-signing/state.json`，其中包含 signer private seeds，
必須視為敏感資料。

## Legal Entity Identifier

LEI 在每次呼叫 `signJson` 時傳入，必須是通過 ISO 17442-1 checksum 的 20 字元
字串。它會寫入 signed `protected` 區塊，因此與該次 payload、signer 及簽章時間
一起受 signer signature 保護。驗證成功後可從 `result.lei` 取得；驗證端也可傳入
`expectedLei`，確保 envelope 屬於預期 legal entity。

## Usage

```ts
import { VleiJsonSigning } from "@repo/vlei-json-signing";

const signing = new VleiJsonSigning();
const { rootAid } = await signing.initialize();

await signing.createSigner({
  id: "alice",
  info: {
    name: "Alice Chen",
    department: "Finance",
    role: "Approver",
  },
});

const envelope = await signing.signJson({
  signerId: "alice",
  lei: "8755001ELOZEL05BVX22",
  payload: {
    orderId: "ORD-001",
    amount: 1000,
    currency: "TWD",
  },
});

const result = await signing.verifyJson(envelope, {
  expectedRootAid: rootAid,
  expectedLei: "8755001ELOZEL05BVX22",
});

if (result.valid) {
  console.log(result.payload);
  console.log(result.signer.info);
} else {
  console.error(result.errors);
}
```

驗證服務只需要公開的 `rootAid`，不需要 root seed。若未傳入
`expectedRootAid`，package 會從設定的 root seed 環境變數推導預期 AID。

## Envelope

```json
{
  "v": "VLEIJSON10",
  "payload": { "orderId": "ORD-001", "amount": 1000 },
  "protected": {
    "v": "VLEIJSON10",
    "payloadDigest": "F...",
    "lei": "8755001ELOZEL05BVX22",
    "signerAid": "F...",
    "signerCredentialSaid": "F...",
    "signedAt": "2026-08-29T10:30:00.000Z"
  },
  "signature": "0B...",
  "signer": {
    "credential": {},
    "credentialSignature": "0B...",
    "rootKeyAtIssuance": "D..."
  },
  "proof": {
    "rootAid": "F...",
    "rootKel": [],
    "signerKel": [],
    "registry": {},
    "credentialTel": []
  }
}
```

`payload` 會先以 RFC 8785/JCS canonicalization 正規化，再計算 CESR digest。
簽章涵蓋 `protected` 區塊，因此 object key 順序不影響驗證，任何值或證明資料
遭修改則會驗證失敗。
