import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

export default [
  layout("routes/portal-layout.tsx", [
    index("routes/dashboard.tsx"),
    route("shipments", "routes/shipments.tsx"),
    route("exports/new", "routes/new-export-object.tsx"),
    route("exports/documents/new", "routes/new-export-document.tsx"),
  ]),
] satisfies RouteConfig;
