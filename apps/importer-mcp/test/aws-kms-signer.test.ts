import assert from "node:assert/strict";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak256, recoverAddress, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kmsDerSignatureToEthereum } from "../src/payment/aws-kms-signer.js";

test("converts a KMS DER signature into an Ethereum signature", async () => {
  const privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const digest = keccak256(toHex("kms signer test"));
  const der = secp256k1.sign(toBytes(digest), toBytes(privateKey), { lowS: false }).toDERRawBytes();
  const expectedAddress = privateKeyToAccount(privateKey).address;
  const signature = kmsDerSignatureToEthereum(digest, der, expectedAddress);
  assert.equal((await recoverAddress({ hash: digest, signature })).toLowerCase(), expectedAddress.toLowerCase());
});
