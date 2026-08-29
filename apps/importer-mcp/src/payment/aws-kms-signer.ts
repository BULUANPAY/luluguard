import { createPublicKey } from "node:crypto";
import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
  type KMSClientConfig
} from "@aws-sdk/client-kms";
import type { ClientEvmSigner } from "@x402/evm";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hashTypedData, serializeSignature, toBytes, toHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";

export interface KmsPublicKey {
  der: Uint8Array;
  keySpec?: string;
  keyUsage?: string;
}

/** Provider-neutral boundary between x402 signing and a KMS implementation. */
export interface KmsSigningService {
  getPublicKey(): Promise<KmsPublicKey>;
  signDigest(digest: `0x${string}`): Promise<Uint8Array>;
}

export interface AwsKmsSignerOptions {
  keyId: string;
  region: string;
  endpoint?: string;
  expectedAddress: `0x${string}`;
}

export class AwsKmsSigningService implements KmsSigningService {
  private readonly client: KMSClient;

  constructor(
    private readonly keyId: string,
    config: KMSClientConfig
  ) {
    this.client = new KMSClient(config);
  }

  async getPublicKey(): Promise<KmsPublicKey> {
    const result = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!result.PublicKey) throw new Error("AWS KMS GetPublicKey returned no public key");
    return { der: result.PublicKey, keySpec: result.KeySpec, keyUsage: result.KeyUsage };
  }

  async signDigest(digest: `0x${string}`): Promise<Uint8Array> {
    const result = await this.client.send(new SignCommand({
      KeyId: this.keyId,
      Message: Buffer.from(digest.slice(2), "hex"),
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256"
    }));
    if (!result.Signature) throw new Error("AWS KMS Sign returned no signature");
    return result.Signature;
  }
}

function publicKeyDerToAddress(publicKeyDer: Uint8Array): `0x${string}` {
  const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: "der", type: "spki" });
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "secp256k1" || !jwk.x || !jwk.y) {
    throw new Error("KMS public key is not secp256k1");
  }
  const uncompressed = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url")
  ]);
  return publicKeyToAddress(toHex(uncompressed));
}

export function kmsDerSignatureToEthereum(
  digest: `0x${string}`,
  derSignature: Uint8Array,
  expectedAddress: `0x${string}`
): `0x${string}` {
  const signature = secp256k1.Signature.fromDER(derSignature).normalizeS();
  for (const recovery of [0, 1] as const) {
    const recoveredKey = signature.addRecoveryBit(recovery).recoverPublicKey(toBytes(digest)).toRawBytes(false);
    const recoveredAddress = publicKeyToAddress(toHex(recoveredKey));
    if (recoveredAddress.toLowerCase() === expectedAddress.toLowerCase()) {
      return serializeSignature({
        r: toHex(signature.r, { size: 32 }),
        s: toHex(signature.s, { size: 32 }),
        yParity: recovery
      });
    }
  }
  throw new Error("Unable to recover the configured importer address from KMS signature");
}

export async function createKmsSigner(
  kms: KmsSigningService,
  expectedAddress: `0x${string}`
): Promise<ClientEvmSigner> {
  const publicKey = await kms.getPublicKey();
  if (publicKey.keySpec && publicKey.keySpec !== "ECC_SECG_P256K1") {
    throw new Error(`KMS key must use ECC_SECG_P256K1, received ${publicKey.keySpec}`);
  }
  if (publicKey.keyUsage && publicKey.keyUsage !== "SIGN_VERIFY") {
    throw new Error(`KMS key must use SIGN_VERIFY, received ${publicKey.keyUsage}`);
  }
  const kmsAddress = publicKeyDerToAddress(publicKey.der);
  if (kmsAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`IMPORTER_ADDRESS does not match KMS key address ${kmsAddress}`);
  }

  return {
    address: kmsAddress,
    async signTypedData(typedData) {
      const digest = hashTypedData(typedData as Parameters<typeof hashTypedData>[0]);
      const signature = await kms.signDigest(digest);
      return kmsDerSignatureToEthereum(digest, signature, kmsAddress);
    }
  };
}

export async function createAwsKmsSigner(options: AwsKmsSignerOptions): Promise<ClientEvmSigner> {
  const clientConfig: KMSClientConfig = { region: options.region };
  if (options.endpoint) clientConfig.endpoint = options.endpoint;
  return createKmsSigner(
    new AwsKmsSigningService(options.keyId, clientConfig),
    options.expectedAddress
  );
}
