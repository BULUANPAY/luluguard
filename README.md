# LuLuGuard

進出口協作平台的 monorepo。第一個前端為多角色共用的 Portal，以權限而非角色名稱控制功能。

## Workspace

- `apps/portal`：React Router SPA，包含總覽、貨件、公司切換與權限範例。
- `packages/ui`：Tailwind CSS 與共用 UI 元件。
- `packages/shared`：與框架無關的 permission、organization 等共用型別。
- `packages/api-client`：OpenAPI 規格、Orval 設定與自動產生的 TanStack Query hooks。

開發環境會自動注入本機 API adapter，因此後端尚未完成也能開發完整頁面；正式 build 只會使用 `/api`。

## Commands

```sh
pnpm install
pnpm dev:portal
pnpm generate:api
pnpm build
pnpm lint
pnpm check-types
pnpm test
```

需要 Node.js 24 以上；repo 的 `.nvmrc` 目前指定 Node.js 26。

## Backend integration

後端 OpenAPI 契約就緒後，以實際 schema 取代 `packages/api-client/openapi/luluguard.yaml`，再執行 `pnpm generate:api`。瀏覽器請求會透過 `/api` 同源路徑發送，並預設攜帶 HttpOnly session cookie。
