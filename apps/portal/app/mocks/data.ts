import type { Session, Shipment } from "@luluguard/api-client";

export const sessionFixture: Session = {
  user: {
    id: "usr-001",
    name: "陳品妤",
    email: "pinyu@example.com",
  },
  activeOrganization: {
    id: "org-exporter",
    name: "森沐實業",
    kind: "exporter",
  },
  organizations: [
    { id: "org-exporter", name: "森沐實業", kind: "exporter" },
    { id: "org-broker", name: "迅捷報關行", kind: "customs-broker" },
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
  { id: "shp-001", reference: "LG-IMP-240829-01", origin: "Yokohama, JP", destination: "Kaohsiung, TW", eta: "2026-09-03", status: "pending-documents", updatedAt: "2026-08-29T08:20:00Z" },
  { id: "shp-002", reference: "LG-IMP-240828-03", origin: "Busan, KR", destination: "Keelung, TW", eta: "2026-09-01", status: "ready-for-declaration", updatedAt: "2026-08-29T07:45:00Z" },
  { id: "shp-003", reference: "LG-IMP-240827-08", origin: "Shanghai, CN", destination: "Taichung, TW", eta: "2026-08-31", status: "customs-review", updatedAt: "2026-08-28T15:10:00Z" },
  { id: "shp-004", reference: "LG-IMP-240822-02", origin: "Los Angeles, US", destination: "Kaohsiung, TW", eta: "2026-08-29", status: "released", updatedAt: "2026-08-29T03:30:00Z" },
  { id: "shp-005", reference: "LG-IMP-240821-06", origin: "Hamburg, DE", destination: "Keelung, TW", eta: "2026-09-12", status: "ready-for-declaration", updatedAt: "2026-08-27T11:05:00Z" },
];
