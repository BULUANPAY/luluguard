import type { Permission } from "@luluguard/shared";

export function hasPermission(
  permissions: readonly Permission[],
  permission: Permission,
) {
  return permissions.includes(permission);
}

export function requirePermission(
  permissions: readonly Permission[],
  permission: Permission,
) {
  if (!hasPermission(permissions, permission)) {
    throw new Response("Forbidden", { status: 403 });
  }
}
