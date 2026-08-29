import type { Permission } from "@luluguard/shared";
import type { ReactNode } from "react";

import { hasPermission } from "./permissions";
import { useSession } from "./session-context";

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { session } = useSession();

  return hasPermission(session.permissions, permission) ? children : fallback;
}
