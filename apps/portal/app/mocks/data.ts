import type { Session, Shipment } from "@luluguard/api-client";

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
    { id: "org-exporter", name: "Sinclair Livestock Exports Ltd.", kind: "exporter" },
    { id: "org-broker", name: "Swift Customs Brokers Ltd.", kind: "customs-broker" },
  ],
  permissions: [
    "dashboard:read",
    "shipment:read",
    "shipment:create",
    "shipment:update",
    "export-object:create",
    "document:upload",
  ],
};

export const shipmentFixtures: Shipment[] = [
  { id: "shp-001", reference: "SLE-LVS-240829-01", origin: "Inverness, GB", destination: "Kaohsiung, TW", eta: "2026-09-03", status: "pending-documents", updatedAt: "2026-08-29T08:20:00Z" },
  { id: "shp-002", reference: "SLE-LVS-240828-03", origin: "Inverness, GB", destination: "Yokohama, JP", eta: "2026-09-01", status: "ready-for-declaration", updatedAt: "2026-08-29T07:45:00Z" },
  { id: "shp-003", reference: "SLE-LVS-240827-08", origin: "Inverness, GB", destination: "Hamburg, DE", eta: "2026-08-31", status: "customs-review", updatedAt: "2026-08-28T15:10:00Z" },
  { id: "shp-004", reference: "SLE-LVS-240822-02", origin: "Inverness, GB", destination: "Singapore, SG", eta: "2026-08-29", status: "released", updatedAt: "2026-08-29T03:30:00Z" },
  { id: "shp-005", reference: "SLE-LVS-240821-06", origin: "Inverness, GB", destination: "New York, US", eta: "2026-09-12", status: "ready-for-declaration", updatedAt: "2026-08-27T11:05:00Z" },
];
