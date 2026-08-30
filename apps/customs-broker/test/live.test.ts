import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import type { ExportDocuments } from "../src/domain.js";

const privateKey = process.env.IMPORTER_PRIVATE_KEY ?? "";
const importerAddress = process.env.IMPORTER_ADDRESS ?? "";
const brokerAddress = process.env.CUSTOMS_BROKER_ADDRESS ?? "";
const liveEnabled = process.env.X402_LIVE_TEST === "1" &&
  /^0x[0-9a-fA-F]{64}$/.test(privateKey) &&
  /^0x[0-9a-fA-F]{40}$/.test(importerAddress) &&
  /^0x[0-9a-fA-F]{40}$/.test(brokerAddress) &&
  !/^0x0{40}$/i.test(brokerAddress);

const documents: ExportDocuments = {
  invoiceNumber: "INV-LIVE-001",
  invoiceDate: "2026-08-29",
  exporter: "Tokyo Precision Instruments Co., Ltd.",
  importer: "Formosa Industrial Systems Co., Ltd.",
  originCountry: "JP",
  destinationCountry: "TW",
  currency: "USD",
  incoterm: "CIF",
  freightUsd: 80,
  insuranceUsd: 12,
  packageCount: 2,
  grossWeightKg: 18.4,
  netWeightKg: 15.2,
  billOfLadingNumber: "ONEYTYOLIVE",
  powerOfAttorney: {
    documentType: "power_of_attorney",
    documentId: "LOA-LIVE-001",
    version: "1.0",
    orderId: "ORDER-LIVE-001",
    acceptedAt: "2026-08-29T00:00:00.000Z",
    importer: {
      name: "Formosa Industrial Systems Co., Ltd.",
      lei: "549300LIVETEST000001"
    },
    representative: {
      employeeId: "EMP-LIVE-001",
      name: "Live Test Importer",
      role: "Import Operations Manager"
    },
    scope: ["Transmit order documents for customs quotation"],
    vleiAuthorization: {
      authorizationId: "AUTH-LIVE-001",
      signerAid: "ELiveSignerAid",
      signerCredentialSaid: "ELiveCredentialSaid"
    }
  },
  providedDocuments: [
    "commercial_invoice",
    "packing_list",
    "bill_of_lading",
    "power_of_attorney"
  ],
  items: [{
    description: "Industrial digital temperature sensors",
    model: "TSP-500",
    material: "Stainless-steel probe",
    intendedUse: "Temperature monitoring",
    quantity: 10,
    unitPriceUsd: 120,
    hsCode: "9025.19"
  }]
};

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test("live Base Sepolia broker smoke test", {
  skip: liveEnabled
    ? false
    : "Set X402_LIVE_TEST=1 with valid importer and broker addresses plus a funded test wallet"
}, async t => {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  assert.equal(account.address.toLowerCase(), importerAddress.toLowerCase());
  assert.equal(config.network, "eip155:84532");

  const created = createApp({ config });
  const server = created.app.listen(0, config.host);
  await once(server, "listening");
  t.after(() => close(server));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://${config.host}:${address.port}`;

  const quoteResponse = await fetch(`${baseUrl}/customs/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(documents)
  });
  assert.equal(quoteResponse.status, 200);
  const { quote } = await quoteResponse.json() as { quote: { quoteId: string } };

  const client = new x402Client().setSpendControls({ maxAmountPerPayment: "$1" });
  client.register(config.network, new ExactEvmScheme(account));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const declarationResponse = await paidFetch(`${baseUrl}/customs/declarations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId: quote.quoteId, documents })
  });

  assert.equal(declarationResponse.status, 200);
  assert.ok(declarationResponse.headers.get("payment-response"));
  const body = await declarationResponse.json() as {
    receipt: { status: string };
  };
  assert.equal(body.receipt.status, "filed");
  assert.equal(created.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
});
