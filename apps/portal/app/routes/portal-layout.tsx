import { Outlet } from "react-router";

import { PortalShell } from "../components/portal-shell";

export default function PortalLayout() {
  return (
    <PortalShell>
      <Outlet />
    </PortalShell>
  );
}
