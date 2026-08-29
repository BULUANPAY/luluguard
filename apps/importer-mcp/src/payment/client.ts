import { x402Client } from "@x402/core/client";
import type { Money, Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { config } from "../config.js";
import { isAllowedPayee } from "./policy.js";
import { createImporterSigner } from "./signer.js";

export function createX402PaidFetch(): typeof globalThis.fetch {
  const { account, brokerAddress } = createImporterSigner();
  const client = new x402Client().setSpendControls({
    maxAmountPerPayment: `$${config.payment.maxUsdc}` as Money
  });
  registerExactEvmScheme(client, {
    signer: account,
    networks: [config.x402.network as Network]
  });
  client.registerPolicy((_version, requirements) =>
    requirements.filter(requirement => isAllowedPayee(requirement.payTo, brokerAddress))
  );
  return wrapFetchWithPayment(globalThis.fetch, client);
}
