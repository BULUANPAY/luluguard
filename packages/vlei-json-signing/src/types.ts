export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface SignerInfo {
  id: string;
  info: JsonObject;
}

export interface AuthorizedSigner extends SignerInfo {
  aid: string;
  credentialSaid: string;
  createdAt: string;
}

export interface ProtectedSignature {
  v: "VLEIJSON10";
  payloadDigest: string;
  lei: string;
  signerAid: string;
  signerCredentialSaid: string;
  signedAt: string;
}

export interface SignedJsonEnvelope<T extends JsonValue = JsonValue> {
  v: "VLEIJSON10";
  payload: T;
  protected: ProtectedSignature;
  signature: string;
  signer: {
    credential: JsonObject;
    credentialSignature: string;
    rootKeyAtIssuance: string;
  };
  proof: {
    rootAid: string;
    rootKel: JsonObject[];
    signerKel: JsonObject[];
    registry: JsonObject;
    credentialTel: JsonObject[];
  };
}

export interface VerificationError {
  code: string;
  message: string;
}

export type VerificationResult<T extends JsonValue = JsonValue> =
  | {
      valid: true;
      payload: T;
      signer: AuthorizedSigner;
      rootAid: string;
      lei: string;
      signedAt: string;
    }
  | {
      valid: false;
      errors: VerificationError[];
    };

export interface VleiJsonSigningOptions {
  stateDir?: string;
  pythonExecutable?: string;
  rootSeedEnvName?: string;
}

export interface VleiStaticOptions {
  pythonExecutable?: string;
}

export interface VleiVerifyOptions extends VleiStaticOptions {
  expectedRootAid: string;
  expectedLei?: string;
}
