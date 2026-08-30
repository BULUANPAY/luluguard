# LuLuGuard

LuLuGuard is a hackathon reference implementation of an importer AI agent that reviews trade documents, obtains a customs broker quote, and pays the broker through x402.

The payment flow uses Base Sepolia USDC with x402 v2 and the `exact` scheme. The Customs Broker app acts as the Seller / Resource Server and delegates payment verification and settlement to the configured Facilitator.

## Workspace

This repository is a pnpm and Turborepo monorepo.

```text
apps/
├── web/              Next.js UI and policy administration
├── importer-mcp/     Importer workflow, MCP tools, payment policy, and signer
└── customs-broker/   x402 Seller / Resource Server
packages/
├── eslint-config/
└── typescript-config/
```

| Service        | Default URL                          |
| -------------- | ------------------------------------ |
| Web            | `http://localhost:3000`              |
| Policy admin   | `http://localhost:3000/admin/policy` |
| Importer MCP   | `http://127.0.0.1:4020/mcp`          |
| Customs Broker | `http://127.0.0.1:4021`              |

## Requirements

- Node.js 24 or newer; `.nvmrc` currently selects Node.js 26
- pnpm 11.23.0
- A Gemini or OpenAI API key
- A funded Base Sepolia test wallet only when running a real x402 payment

## Setup

Install dependencies from the repository root:

```sh
nvm use
pnpm install
```

Create local environment files:

```sh
cp apps/web/.env.local.example apps/web/.env.local
cp apps/importer-mcp/.env.example apps/importer-mcp/.env
cp apps/customs-broker/.env.example apps/customs-broker/.env
```

Replace the placeholders documented in each example file. The Importer and Customs Broker must use the same values for:

- `CUSTOMS_BROKER_ADDRESS`
- `CUSTOMS_BROKER_FEE_USDC`
- `X402_NETWORK`

`CUSTOMS_BROKER_ADDRESS` must be a non-zero Base Sepolia receiving address. When using `SIGNER_PROVIDER=private-key`, `IMPORTER_ADDRESS` must match `IMPORTER_PRIVATE_KEY`.

Use only dedicated testnet wallets. Never commit `.env` files or private keys.

## Run

Start all applications:

```sh
pnpm dev
```

Run applications separately when debugging:

```sh
pnpm --filter @luluguard/customs-broker dev
pnpm --filter @luluguard/importer-mcp dev
pnpm --filter @luluguard/web dev
```

Check the backend services:

```sh
curl http://127.0.0.1:4021/health
curl http://127.0.0.1:4020/health
```

## x402 flow

The importer workflow exposes three MCP tools:

1. `review_import_documents` reviews mock documents and creates an independent estimate.
2. `get_import_quote` sends approved documents to the broker and obtains a free quote.
3. `submit_import_declaration` pays the broker and files the declaration.

The protected Seller flow is:

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

The declaration response is buffered until settlement succeeds. Verification or settlement failure never returns a successful filing receipt.

## Runtime policy administration

Open `http://localhost:3000/admin/policy` and authenticate with `POLICY_ADMIN_API_KEY`. The runtime policy can pause payments, disable the agent, change the broker allowlist, and update per-payment, rolling 24-hour, hourly-count, and human-approval limits.

Policy, quote, payment-history, and reconciliation state is process-local and resets when the corresponding service restarts.

## Settlement reconciliation

If a dispatched payment cannot be confirmed, the Importer records an `ambiguous` or `pending` reconciliation and blocks automatic retry. Use the policy-admin-protected `GET /admin/reconciliation/:quoteId` and `POST /admin/reconciliation/resolve` endpoints to inspect and resolve it.

Only an operator-confirmed terminal failure can release the payment. Attempts, network, payer, amount, and any recorded transaction hash must match; the API does not perform the external on-chain investigation.

## Validation

Run all workspace checks:

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

The Broker suite is offline by default. A funded Base Sepolia wallet is required for the opt-in live smoke test:

```sh
X402_LIVE_TEST=1 pnpm --filter @luluguard/customs-broker test
```

## Scope and limitations

- Customs quotes and declarations are mock data, not a real government or customs integration.
- Quote, payment, and reconciliation state is stored in memory and is lost on restart.
- Replay protection and ownership locks are process-local; this demo is not safe for multi-worker or multi-instance deployment without shared durable storage.
- The implementation supports only Base Sepolia USDC with x402 v2 `exact`.
- Ambiguous settlement outcomes fail closed and require manual review.
