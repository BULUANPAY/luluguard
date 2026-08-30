import { useGetSession, type Session } from "@luluguard/api-client";
import { PERMISSIONS, type Permission } from "@luluguard/shared";
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface AppSession extends Omit<Session, "permissions"> {
  permissions: Permission[];
}

interface SessionContextValue {
  session: AppSession;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isPending, isError } = useGetSession();

  const value = useMemo<SessionContextValue | null>(() => {
    if (!data) return null;

    const activeOrganization =
      data.activeOrganization.kind === "exporter"
        ? data.activeOrganization
        : data.organizations.find(({ kind }) => kind === "exporter");

    if (!activeOrganization) return null;

    return {
      session: {
        ...data,
        activeOrganization,
        organizations: [activeOrganization],
        permissions: data.permissions.filter(isPermission),
      },
    };
  }, [data]);

  if (isPending) {
    return <SessionState message="正在載入公司與權限…" />;
  }

  if (isError || !value) {
    return <SessionState message="無法取得出口商登入資訊，請稍後再試。" />;
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return value;
}

function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

function SessionState({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <p className="rounded-xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground shadow-sm">
        {message}
      </p>
    </main>
  );
}
