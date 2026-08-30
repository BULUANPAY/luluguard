import { x402Client } from "@x402/core/client";
import type { Money, Network } from "@x402/core/types";
import { convertToTokenAmount, numberToDecimalString } from "@x402/core/utils";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { config } from "../config.js";
import { isAllowedPayee } from "./policy.js";
import { createImporterSigner } from "./signer.js";

export type PaymentDispatchAwareFetch = typeof globalThis.fetch & {
  getPaymentDispatchState: () => boolean;
};

const USDC_DECIMALS = 6;

function configuredBrokerFeeAtomic(): string {
  const feeUsdc = config.customsBroker.feeUsdc;
  if (!Number.isFinite(feeUsdc) || feeUsdc <= 0) {
    throw new Error("CUSTOMS_BROKER_FEE_USDC must be a positive finite number");
  }
  const decimalAmount = numberToDecimalString(feeUsdc);
  const fractionalPart = decimalAmount.split(".")[1] ?? "";
  if (/[1-9]/.test(fractionalPart.slice(USDC_DECIMALS))) {
    throw new Error(
      `CUSTOMS_BROKER_FEE_USDC ${feeUsdc} cannot be represented exactly with USDC's ${USDC_DECIMALS} decimals`
    );
  }
  return convertToTokenAmount(decimalAmount, USDC_DECIMALS);
}

export function createUnpaidFetch(): PaymentDispatchAwareFetch {
  const trackedFetch = (async (input, init) => globalThis.fetch(input, init)) as PaymentDispatchAwareFetch;
  trackedFetch.getPaymentDispatchState = () => false;
  return trackedFetch;
}

export async function createX402PaidFetch(): Promise<PaymentDispatchAwareFetch> {
  if (config.x402.network !== "eip155:84532") {
    throw new Error("X402_NETWORK must be eip155:84532 for the testnet importer");
  }
  const { account, brokerAddress } = await createImporterSigner();
  const expectedBrokerFeeAtomic = configuredBrokerFeeAtomic();
  const client = new x402Client().setSpendControls({
    maxAmountPerPayment: `$${config.payment.maxUsdc}` as Money
  });
  registerExactEvmScheme(client, {
    signer: account,
    networks: [config.x402.network as Network]
  });
  client.registerPolicy((version, requirements) => requirements.filter(requirement =>
    version === 2 &&
    requirement.scheme === "exact" &&
    requirement.network === config.x402.network &&
    isAllowedPayee(requirement.payTo, brokerAddress) &&
    requirement.amount === expectedBrokerFeeAtomic
  ));
  let paymentDispatched = false;
  const transportFetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.headers.has("payment-signature") || request.headers.has("x-payment")) {
      paymentDispatched = true;
    }
    return globalThis.fetch(input, init);
  };
  const wrappedFetch = wrapFetchWithPayment(transportFetch, client);
  let paymentFetchInFlight = false;
  const trackedFetch = (async (input, init) => {
    if (paymentFetchInFlight) {
      throw new Error("Concurrent x402 payment requests are not supported by this fetch instance");
    }
    paymentFetchInFlight = true;
    paymentDispatched = false;
    try {
      return await wrappedFetch(input, init);
    } finally {
      paymentFetchInFlight = false;
    }
  }) as PaymentDispatchAwareFetch;
  trackedFetch.getPaymentDispatchState = () => paymentDispatched;
  return trackedFetch;
}
