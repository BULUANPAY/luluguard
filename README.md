# LuLuGuard

LuLuGuard is an importer AI agent demo built with Next.js, MCP, and x402 payments. It separates document review, broker quotation, and paid customs submission into explicit stages.

## Workspace

This repository is a pnpm and Turborepo monorepo.

```text
apps/
├── importer-mcp/       MCP server, importer workflow, payment policy, and x402 signer
└── web/                Next.js chat UI, policy admin UI, and server-side AI integration
packages/
├── eslint-config/      Shared ESLint configuration
└── typescript-config/  Shared TypeScript configuration
```

| Application  | Default URL                          | Purpose                          |
| ------------ | ------------------------------------ | -------------------------------- |
| Web          | `http://localhost:3000`              | Import workflow UI and AI chat   |
| Trade portal | `http://localhost:5173`              | Import/export document workspace |
| vLEI signing | `http://localhost:3001`              | JSON signing API                 |
| Policy admin | `http://localhost:3000/admin/policy` | Runtime payment-policy controls  |
| Importer MCP | `http://127.0.0.1:4020/mcp`          | Streamable HTTP MCP endpoint     |
| MCP health   | `http://127.0.0.1:4020/health`       | Importer service health check    |

## Requirements

- Node.js 24 or newer; `.nvmrc` currently selects Node.js 26
- pnpm 11.23.0
- A Gemini or OpenAI API key

## Setup

Install dependencies from the repository root:

```sh
nvm use
pnpm install
```

Create local environment files:

```sh
cp apps/importer-mcp/.env.example apps/importer-mcp/.env
cp apps/web/.env.local.example apps/web/.env.local
```

Both generated files are ignored by Git. Replace every placeholder before testing authenticated MCP access, policy administration, or payment.

### Web environment

Configure `apps/web/.env.local`:

| Variable         | Description                                            |
| ---------------- | ------------------------------------------------------ |
| `AI_PROVIDER`    | `gemini` or `openai`                                   |
| `GEMINI_API_KEY` | Required when using Gemini                             |
| `GEMINI_MODEL`   | Gemini model name                                      |
| `OPENAI_API_KEY` | Required when using OpenAI                             |
| `OPENAI_MODEL`   | OpenAI model name                                      |
| `MCP_SERVER_URL` | Importer MCP URL, normally `http://127.0.0.1:4020/mcp` |
| `MCP_API_KEY`    | Must exactly match the Importer MCP value              |
| `VLEI_VERIFY_MCP_COMMAND` | Optional verifier command; defaults to `pnpm`          |
| `VLEI_VERIFY_MCP_ARGS`    | Optional JSON array of command arguments                |
| `VLEI_VERIFY_MCP_CWD`     | Optional cwd; defaults to the workspace root            |

Restart the Next.js development server after changing `.env.local`.

### Importer MCP environment

Configure `apps/importer-mcp/.env`:

| Variable group  | Variables                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Broker          | `CUSTOMS_BROKER_API_URL`, `CUSTOMS_BROKER_ADDRESS`, `CUSTOMS_BROKER_FEE_USDC`                      |
| Importer signer | `IMPORTER_ADDRESS`, `SIGNER_PROVIDER`, `IMPORTER_PRIVATE_KEY`                                      |
| AWS KMS signer  | `AWS_PROFILE`, `AWS_REGION`, `AWS_KMS_KEY_ID`, optional `AWS_KMS_ENDPOINT`                         |
| Payment limits  | `MAX_PAYMENT_USDC`, `MAX_DAILY_PAYMENT_USDC`, `MAX_PAYMENTS_PER_HOUR`, `HUMAN_APPROVAL_ABOVE_USDC` |
| x402            | `X402_NETWORK`                                                                                     |
| MCP server      | `MCP_HOST`, `MCP_PORT`, `MCP_API_KEY`                                                              |
| Policy admin    | `POLICY_ADMIN_API_KEY`                                                                             |
| Logging         | `LOG_LEVEL`                                                                                        |

Use `SIGNER_PROVIDER=private-key` for a local private key. To use AWS KMS, set `SIGNER_PROVIDER=aws-kms` and configure the AWS variables.

## Run locally

Start the applications:

```sh
pnpm dev
```

Turborepo 會先 build Web 所依賴的 vLEI verifier MCP 與 JSON signing package。

Alternatively, run each application in a separate terminal:

```sh
pnpm --filter @luluguard/importer-mcp dev
```

```sh
pnpm --filter @luluguard/web dev
```

For the trade portal's I/V and P/L generator, start these in separate terminals:

```sh
pnpm dev:vlei-signing-api
pnpm dev:portal
```

The portal defaults to `http://localhost:3001` for signing. Override it with
`VITE_VLEI_SIGNING_API_URL`; set `VITE_VLEI_SIGNING_LEI` to use another valid
ISO 17442 LEI. The signing API's browser origin can be restricted with
`VLEI_SIGNING_ALLOWED_ORIGIN`.

Confirm that the MCP server is available:

```sh
curl http://127.0.0.1:4020/health
```

Expected response:

```json
{ "status": "ok", "service": "x402-importer-mcp" }
```

## Import workflow

The agent exposes three MCP tools in a fixed progression:

1. `review_import_documents`
   - Reviews the mock documents selected in the Web UI.
   - Produces an independent importer estimate and a `preflightId`.
   - Does not contact the customs broker and does not pay.
2. `get_import_quote`
   - Requires a successful preflight and explicit estimate confirmation.
   - Transmits the reviewed documents to the customs broker.
   - Compares the broker quote with the independent estimate and compliance checks.
   - Returns a `quoteId` without paying.
3. `submit_import_declaration`
   - Requires a matching reviewed quote that has not expired.
   - Rechecks compliance findings and runtime payment policy.
   - Requires human approval above the configured threshold.
   - Uses x402 to pay the broker and submit the declaration.

Payment can be blocked by agent status, payee allowlist, per-payment limit, rolling 24-hour limit, hourly payment count, missing human approval, an expired quote, or a compliance blocker.

## Runtime policy administration

Open `http://localhost:3000/admin/policy`, enter `POLICY_ADMIN_API_KEY`, and load the active policy. The page can:

- set the agent to `ACTIVE`, `PAYMENT_PAUSED`, or `DISABLED`;
- update payment, daily-spend, hourly-count, and human-approval limits;
- update the allowed broker addresses;
- display payment usage recorded during the current MCP process.

The Web proxy forwards requests to:

- `GET /admin/policy`
- `PUT /admin/policy`

Policy state, preflights, quotes, and payment history are currently stored in memory and reset when the Importer MCP process restarts.

## Validation commands

Run all workspace checks from the repository root:

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Run only the Importer tests:

```sh
pnpm --filter @luluguard/importer-mcp test
```

Build and start production processes in separate terminals:

```sh
pnpm build
pnpm --filter @luluguard/importer-mcp start
```

```sh
pnpm --filter @luluguard/web start
```
