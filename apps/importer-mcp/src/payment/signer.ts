import type { ClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { createAwsKmsSigner } from "./aws-kms-signer.js";

export interface ImporterSigner {
  account: ClientEvmSigner;
  importerAddress: `0x${string}`;
  brokerAddress: `0x${string}`;
}

export function requireAddress(name: string, address: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
    throw new Error(`${name} must be a valid EVM address`);
  }
  return address as `0x${string}`;
}

export async function createImporterSigner(): Promise<ImporterSigner> {
  const importerAddress = requireAddress("IMPORTER_ADDRESS", config.importer.address);
  const brokerAddress = requireAddress("CUSTOMS_BROKER_ADDRESS", config.customsBroker.address);
  const provider = config.signer.provider.toLowerCase();

  if (provider === "aws-kms") {
    if (!config.signer.awsKms.keyId) throw new Error("AWS_KMS_KEY_ID is required for aws-kms signer");
    if (!config.signer.awsKms.region) throw new Error("AWS_REGION is required for aws-kms signer");
    const account = await createAwsKmsSigner({
      keyId: config.signer.awsKms.keyId,
      region: config.signer.awsKms.region,
      endpoint: config.signer.awsKms.endpoint,
      expectedAddress: importerAddress
    });
    return { account, importerAddress, brokerAddress };
  }

  if (provider !== "private-key") throw new Error(`Unsupported SIGNER_PROVIDER: ${provider}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.importer.privateKey)) {
    throw new Error("IMPORTER_PRIVATE_KEY must be a 32-byte EVM private key");
  }
  const account = privateKeyToAccount(config.importer.privateKey as `0x${string}`);
  if (account.address.toLowerCase() !== importerAddress.toLowerCase()) {
    throw new Error("IMPORTER_ADDRESS does not match IMPORTER_PRIVATE_KEY");
  }
  return { account, importerAddress, brokerAddress };
}
