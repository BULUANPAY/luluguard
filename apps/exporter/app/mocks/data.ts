import type { Session } from "@luluguard/api-client";

export const sessionFixture: Session = {
  user: {
    id: "usr-001",
    name: "James Sinclair",
    email: "james@sinclair-livestock.example",
  },
  activeOrganization: {
    id: "org-exporter",
    name: "Sinclair Livestock Exports Ltd.",
    kind: "exporter",
  },
  organizations: [
    {
      id: "org-exporter",
      name: "Sinclair Livestock Exports Ltd.",
      kind: "exporter",
    },
  ],
  permissions: ["document:upload"],
};
