import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";

function requireAddress(name: string, address: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${name} must be a valid EVM address`);
  }
  return address as `0x${string}`;
}

export function createImporterSigner() {
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.importer.privateKey)) {
    throw new Error("IMPORTER_PRIVATE_KEY must be a 32-byte EVM private key");
  }
  const importerAddress = requireAddress("IMPORTER_ADDRESS", config.importer.address);
  const brokerAddress = requireAddress("CUSTOMS_BROKER_ADDRESS", config.customsBroker.address);
  const account = privateKeyToAccount(config.importer.privateKey as `0x${string}`);
  if (account.address.toLowerCase() !== importerAddress.toLowerCase()) {
    throw new Error("IMPORTER_ADDRESS does not match IMPORTER_PRIVATE_KEY");
  }
  return { account, importerAddress, brokerAddress };
}
