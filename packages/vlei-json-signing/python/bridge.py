#!/usr/bin/env python3
"""JSON protocol bridge from the TypeScript package to vlei-sandbox mock APIs."""

import argparse
import contextlib
import datetime
import fcntl
import hashlib
import hmac
import json
import os
import sys
import tempfile


STATE_VERSION = 1
ENVELOPE_VERSION = "VLEIJSON10"
REGISTRY_NAME = "jsonSignerRegistry"
STATE_FILE = "state.json"
LOCK_FILE = "state.lock"


class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def configure_sandbox(scripts_path):
    if not os.path.isdir(scripts_path):
        raise BridgeError("SANDBOX_NOT_FOUND", "vlei-sandbox scripts directory was not found")
    sys.path.insert(0, scripts_path)
    global cesr, keri, vlei
    import cesr as cesr_module
    import keri as keri_module
    import vlei_sandbox as vlei_module

    cesr = cesr_module
    keri = keri_module
    vlei = vlei_module

    # vlei-sandbox selects Blake3 when an optional module is present. Pin the
    # standard-library Blake2b mode so the same seed always yields the same AID.
    cesr.DIGEST_CODE = cesr.CODE_BLAKE2B_256
    cesr.DIGEST_NAME = "Blake2b-256"
    cesr._digest_bytes = lambda data: hashlib.blake2b(data, digest_size=32).digest()


def read_root_secret(env_name):
    value = os.environ.get(env_name)
    if value is None:
        raise BridgeError("ROOT_SEED_MISSING", f"Environment variable {env_name} is required")
    if value == "":
        raise BridgeError("ROOT_SEED_INVALID", f"Environment variable {env_name} must not be empty")
    return value.encode("utf-8")


def validate_lei(value):
    if not isinstance(value, str) or value == "":
        raise BridgeError("LEI_MISSING", "A Legal Entity Identifier is required when signing")
    lei = value.upper()
    valid, reason = vlei.lei_validate(lei)
    if not valid:
        raise BridgeError("LEI_INVALID", f"Legal Entity Identifier is invalid: {reason}")
    return lei


def derive_root_seed(root_secret, info):
    salt = b"vlei-json-signing/hkdf-sha256/v1"
    pseudorandom_key = hmac.new(salt, root_secret, hashlib.sha256).digest()
    return hmac.new(pseudorandom_key, info + b"\x01", hashlib.sha256).digest()


def build_root_controller(root_secret):
    controller = keri.Controller("root")
    current_seed = derive_root_seed(root_secret, b"root-current-key")
    next_seed = derive_root_seed(root_secret, b"root-next-key")
    controller.seed = cesr.encode(cesr.CODE_ED25519_SEED, current_seed)
    controller.verkey = cesr.encode(
        cesr.CODE_ED25519, keri.ed.public_key(current_seed)
    )
    controller.next_seed = cesr.encode(cesr.CODE_ED25519_SEED, next_seed)
    controller.next_verkey = cesr.encode(
        cesr.CODE_ED25519, keri.ed.public_key(next_seed)
    )
    controller.aid = None
    controller.kel = []
    controller.registries = {}
    controller.incept()
    return controller


def public_controller_state(controller):
    state = controller.to_state()
    state.pop("seed", None)
    state.pop("next_seed", None)
    return state


def hydrate_root(state, root_secret):
    derived = build_root_controller(root_secret)
    if state["root"]["aid"] != derived.aid:
        raise BridgeError(
            "ROOT_AID_MISMATCH",
            "The configured root seed does not match the root AID in the existing state",
        )
    if (
        state["root"].get("verkey") != derived.verkey
        or state["root"].get("next_verkey") != derived.next_verkey
    ):
        raise BridgeError("STATE_INVALID", "Persisted root key material is invalid")
    persisted = dict(state["root"])
    persisted["seed"] = derived.seed
    persisted["next_seed"] = derived.next_seed
    return keri.Controller("root", persisted)


def signer_schema():
    schema = {
        "$id": "",
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "Root-authorized JSON signer",
        "type": "object",
        "properties": {
            "i": {"type": "string"},
            "dt": {"type": "string"},
            "signerId": {"type": "string"},
            "info": {"type": "object"},
        },
        "required": ["i", "dt", "signerId", "info"],
        "additionalProperties": False,
    }
    said, schema = cesr.saidify(schema, label="$id", protocol="ACDC")
    return said, schema


def state_path(state_dir):
    return os.path.join(state_dir, STATE_FILE)


@contextlib.contextmanager
def state_lock(state_dir):
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    try:
        os.chmod(state_dir, 0o700)
    except OSError:
        pass
    lock_path = os.path.join(state_dir, LOCK_FILE)
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def load_state(state_dir):
    path = state_path(state_dir)
    if not os.path.exists(path):
        raise BridgeError("STATE_NOT_INITIALIZED", "Signing state has not been initialized")
    try:
        with open(path, encoding="utf-8") as stream:
            state = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise BridgeError("STATE_INVALID", "Signing state is unreadable or invalid") from error
    if state.get("version") != STATE_VERSION:
        raise BridgeError("STATE_VERSION_UNSUPPORTED", "Signing state version is unsupported")
    return state


def save_state(state_dir, state):
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix="state.", suffix=".tmp", dir=state_dir)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(state, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, state_path(state_dir))
        os.chmod(state_path(state_dir), 0o600)
    except Exception:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise


def initialize_state(state_dir, root_secret):
    path = state_path(state_dir)
    if os.path.exists(path):
        state = load_state(state_dir)
        hydrate_root(state, root_secret)
        return state

    root = build_root_controller(root_secret)
    root.create_registry(REGISTRY_NAME)
    schema_said, schema = signer_schema()
    state = {
        "version": STATE_VERSION,
        "digest": cesr.DIGEST_NAME,
        "root_aid": root.aid,
        "root": public_controller_state(root),
        "signer_schema": {"said": schema_said, "schema": schema},
        "signers": {},
        "credentials": {},
    }
    save_state(state_dir, state)
    return state


def require_state(state_dir, root_secret):
    state = load_state(state_dir)
    root = hydrate_root(state, root_secret)
    return state, root


def create_signer(state_dir, root_secret, signer_id, info):
    if not isinstance(signer_id, str) or not signer_id.strip():
        raise BridgeError("INVALID_SIGNER_ID", "Signer id must not be empty")
    if not isinstance(info, dict):
        raise BridgeError("INVALID_SIGNER_INFO", "Signer info must be a JSON object")

    with state_lock(state_dir):
        state = initialize_state(state_dir, root_secret)
        existing = state["signers"].get(signer_id)
        if existing:
            credential = state["credentials"][existing["credential_said"]]["acdc"]
            if credential["a"]["info"] != info:
                raise BridgeError(
                    "SIGNER_ID_CONFLICT", "Signer id already exists with different information"
                )
            return authorized_signer(state, signer_id)

        root = hydrate_root(state, root_secret)
        signer = keri.Controller(signer_id)
        signer.incept(delegator=root.aid)
        registry = root.registries[REGISTRY_NAME]
        said, acdc = keri.build_acdc(
            issuer_aid=root.aid,
            registry_key=registry["regk"],
            schema_said=state["signer_schema"]["said"],
            holder_aid=signer.aid,
            attributes={"signerId": signer_id, "info": info},
        )
        root.issue_event(REGISTRY_NAME, said)
        credential_signature = keri.sign_bytes(root.seed, cesr.dumps(acdc))

        state["root"] = public_controller_state(root)
        state["signers"][signer_id] = {
            "controller": signer.to_state(),
            "credential_said": said,
        }
        state["credentials"][said] = {
            "acdc": acdc,
            "signature": credential_signature,
            "root_key_at_issuance": root.verkey,
        }
        save_state(state_dir, state)
        return authorized_signer(state, signer_id)


def authorized_signer(state, signer_id):
    signer_entry = state["signers"][signer_id]
    credential = state["credentials"][signer_entry["credential_said"]]["acdc"]
    return {
        "id": signer_id,
        "info": credential["a"]["info"],
        "aid": signer_entry["controller"]["aid"],
        "credentialSaid": signer_entry["credential_said"],
        "createdAt": credential["a"]["dt"],
    }


def sign_json(state_dir, root_secret, lei, signer_id, payload, canonical_payload):
    lei = validate_lei(lei)
    state, _root = require_state(state_dir, root_secret)
    signer_entry = state["signers"].get(signer_id)
    if not signer_entry:
        raise BridgeError("SIGNER_NOT_FOUND", f"Unknown signer {signer_id!r}")
    signer = keri.Controller(signer_id, signer_entry["controller"])
    credential_said = signer_entry["credential_said"]
    credential_entry = state["credentials"][credential_said]
    protected = {
        "v": ENVELOPE_VERSION,
        "payloadDigest": cesr.digest(canonical_payload.encode("utf-8")),
        "lei": lei,
        "signerAid": signer.aid,
        "signerCredentialSaid": credential_said,
        "signedAt": utc_now(),
    }
    signature = keri.sign_bytes(signer.seed, canonical_bytes(protected))
    root_registry = state["root"]["registries"][REGISTRY_NAME]
    return {
        "v": ENVELOPE_VERSION,
        "payload": payload,
        "protected": protected,
        "signature": signature,
        "signer": {
            "credential": credential_entry["acdc"],
            "credentialSignature": credential_entry["signature"],
            "rootKeyAtIssuance": credential_entry["root_key_at_issuance"],
        },
        "proof": {
            "rootAid": state["root_aid"],
            "rootKel": state["root"]["kel"],
            "signerKel": signer.kel,
            "registry": root_registry["vcp"],
            "credentialTel": root_registry["tel"][credential_said],
        },
    }


def add_error(errors, code, message):
    errors.append({"code": code, "message": message})


def canonical_bytes(value):
    """Canonical JSON for the fixed, string-only protected signature block."""
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def validate_kel(kel, expected_aid, expected_delegator, errors, label):
    if not isinstance(kel, list) or not kel:
        add_error(errors, "KEL_INVALID", f"{label} KEL is missing")
        return None
    current_key = None
    prior_digest = None
    for index, sealed in enumerate(kel):
        if not isinstance(sealed, dict) or not isinstance(sealed.get("event"), dict):
            add_error(errors, "KEL_INVALID", f"{label} KEL event {index} is malformed")
            return None
        event = sealed["event"]
        event_type = event.get("t")
        also = ("i",) if index == 0 else ()
        good, _detail = cesr.verify_said(event, label="d", also=also)
        if not good:
            add_error(errors, "KEL_SAID_INVALID", f"{label} KEL event {index} SAID is invalid")
        if index == 0:
            if event_type not in ("icp", "dip") or event.get("i") != expected_aid:
                add_error(errors, "KEL_INCEPTION_INVALID", f"{label} inception does not match its AID")
            if expected_delegator is None:
                if event_type != "icp" or "di" in event:
                    add_error(errors, "ROOT_DELEGATION_INVALID", "Root AID must be self-incepting")
            elif event_type != "dip" or event.get("di") != expected_delegator:
                add_error(errors, "SIGNER_DELEGATION_INVALID", "Signer AID is not delegated by the expected root")
            keys = event.get("k")
            current_key = keys[0] if isinstance(keys, list) and len(keys) == 1 else None
        else:
            if event.get("p") != prior_digest or event.get("s") != f"{index:x}":
                add_error(errors, "KEL_SEQUENCE_INVALID", f"{label} KEL event {index} sequence is invalid")
            if event_type == "rot":
                keys = event.get("k")
                current_key = keys[0] if isinstance(keys, list) and len(keys) == 1 else None
        if not current_key or not keri.verify_bytes(
            current_key, cesr.dumps(event), sealed.get("sig", "")
        ):
            add_error(errors, "KEL_SIGNATURE_INVALID", f"{label} KEL event {index} signature is invalid")
        prior_digest = event.get("d")
    return current_key


def verify_json(envelope, canonical_payload, expected_root_aid, expected_lei):
    errors = []
    if not isinstance(envelope, dict):
        return {"valid": False, "errors": [{"code": "ENVELOPE_INVALID", "message": "Envelope must be an object"}]}
    protected = envelope.get("protected")
    signer_proof = envelope.get("signer")
    proof = envelope.get("proof")
    if envelope.get("v") != ENVELOPE_VERSION or not isinstance(protected, dict):
        add_error(errors, "ENVELOPE_VERSION_INVALID", "Envelope version is invalid")
    if not isinstance(signer_proof, dict) or not isinstance(proof, dict):
        add_error(errors, "PROOF_INVALID", "Envelope proof is missing or malformed")
        return {"valid": False, "errors": errors}

    root_aid = proof.get("rootAid")
    if not expected_root_aid:
        add_error(errors, "EXPECTED_ROOT_REQUIRED", "An expected root AID is required")
    elif root_aid != expected_root_aid:
        add_error(errors, "ROOT_AID_MISMATCH", "Envelope does not chain to the expected root AID")

    expected_digest = cesr.digest(canonical_payload.encode("utf-8"))
    if protected.get("v") != ENVELOPE_VERSION or protected.get("payloadDigest") != expected_digest:
        add_error(errors, "PAYLOAD_DIGEST_INVALID", "Payload digest does not match the signed digest")

    signer_aid = protected.get("signerAid")
    signer_key = validate_kel(proof.get("signerKel"), signer_aid, root_aid, errors, "Signer")
    if not signer_key or not keri.verify_bytes(
        signer_key, canonical_bytes(protected), envelope.get("signature", "")
    ):
        add_error(errors, "DOCUMENT_SIGNATURE_INVALID", "JSON document signature is invalid")

    root_key = validate_kel(proof.get("rootKel"), root_aid, None, errors, "Root")
    credential = signer_proof.get("credential")
    if not isinstance(credential, dict):
        add_error(errors, "SIGNER_CREDENTIAL_INVALID", "Signer credential is missing")
        return {"valid": False, "errors": errors}
    good, _detail = cesr.verify_said(credential, label="d")
    if not good:
        add_error(errors, "SIGNER_CREDENTIAL_SAID_INVALID", "Signer credential SAID is invalid")
    attributes = credential.get("a") if isinstance(credential.get("a"), dict) else {}
    schema_said, _schema = signer_schema()
    if credential.get("s") != schema_said:
        add_error(errors, "SIGNER_CREDENTIAL_SCHEMA_INVALID", "Signer credential schema is not recognized")
    if credential.get("i") != root_aid or attributes.get("i") != signer_aid:
        add_error(errors, "SIGNER_CREDENTIAL_BINDING_INVALID", "Signer credential does not bind root and signer AIDs")
    if credential.get("d") != protected.get("signerCredentialSaid"):
        add_error(errors, "SIGNER_CREDENTIAL_REFERENCE_INVALID", "Protected signer credential reference is invalid")
    credential_lei = protected.get("lei")
    lei_valid, lei_reason = vlei.lei_validate(credential_lei) if isinstance(credential_lei, str) else (False, "missing")
    if not lei_valid:
        add_error(errors, "LEI_INVALID", f"Signed LEI is invalid: {lei_reason}")
    elif expected_lei and credential_lei != expected_lei.upper():
        add_error(errors, "LEI_MISMATCH", "Signature does not match the expected LEI")

    issuance_key = signer_proof.get("rootKeyAtIssuance")
    if not issuance_key or not keri.verify_bytes(
        issuance_key, cesr.dumps(credential), signer_proof.get("credentialSignature", "")
    ):
        add_error(errors, "SIGNER_CREDENTIAL_SIGNATURE_INVALID", "Root signature on signer credential is invalid")

    registry = proof.get("registry")
    tel = proof.get("credentialTel")
    if not isinstance(registry, dict) or not cesr.verify_said(registry, label="d", also=("i",))[0]:
        add_error(errors, "REGISTRY_PROOF_INVALID", "Credential registry proof is invalid")
    elif registry.get("ii") != root_aid or credential.get("ri") != registry.get("i"):
        add_error(errors, "REGISTRY_BINDING_INVALID", "Credential registry is not bound to the expected root")
    else:
        registry_anchored = any(
            seal.get("i") == registry.get("i") and seal.get("d") == registry.get("d")
            for sealed in proof.get("rootKel", [])
            if isinstance(sealed, dict)
            for seal in sealed.get("event", {}).get("a", [])
            if isinstance(seal, dict)
        )
        if not registry_anchored:
            add_error(errors, "REGISTRY_ANCHOR_MISSING", "Credential registry is not anchored in the root KEL")
    if not isinstance(tel, list) or not tel:
        add_error(errors, "TEL_INVALID", "Credential issuance proof is missing")
    else:
        issued = tel[0]
        if not cesr.verify_said(issued, label="d")[0] or issued.get("t") != "iss":
            add_error(errors, "TEL_ISSUANCE_INVALID", "Credential issuance event is invalid")
        if issued.get("i") != credential.get("d") or issued.get("ri") != credential.get("ri"):
            add_error(errors, "TEL_BINDING_INVALID", "Credential issuance event does not match the credential")
        if any(event.get("t") == "rev" for event in tel if isinstance(event, dict)):
            add_error(errors, "SIGNER_CREDENTIAL_REVOKED", "Signer credential is revoked in the supplied snapshot")

        anchor_key = None
        for sealed in proof.get("rootKel", []):
            event = sealed.get("event", {}) if isinstance(sealed, dict) else {}
            if event.get("t") == "rot" and isinstance(event.get("k"), list):
                anchor_key = event["k"][0]
            elif anchor_key is None and isinstance(event.get("k"), list):
                anchor_key = event["k"][0]
            for seal in event.get("a", []):
                if seal.get("i") == credential.get("d") and seal.get("d") == issued.get("d"):
                    if anchor_key != issuance_key:
                        add_error(errors, "ISSUANCE_KEY_INVALID", "Credential signature key does not match its KEL anchor")
                    anchor_key = "__found__"
                    break
            if anchor_key == "__found__":
                break
        if anchor_key != "__found__":
            add_error(errors, "ISSUANCE_ANCHOR_MISSING", "Credential issuance is not anchored in the root KEL")

    if errors:
        return {"valid": False, "errors": errors}
    return {
        "valid": True,
        "payload": envelope.get("payload"),
        "signer": {
            "id": attributes["signerId"],
            "info": attributes["info"],
            "aid": signer_aid,
            "credentialSaid": credential["d"],
            "createdAt": attributes["dt"],
        },
        "rootAid": root_aid,
        "lei": protected["lei"],
        "signedAt": protected["signedAt"],
    }


def expected_root(request, state_dir):
    explicit = request["input"].get("expectedRootAid")
    if explicit:
        return explicit
    env_name = request.get("rootSeedEnvName", "VLEI_ROOT_SEED")
    root_secret = read_root_secret(env_name)
    state_path_value = state_path(state_dir)
    if os.path.exists(state_path_value):
        state = load_state(state_dir)
        return hydrate_root(state, root_secret).aid
    return build_root_controller(root_secret).aid


def dispatch(request, state_dir):
    command = request.get("command")
    data = request.get("input") or {}
    env_name = request.get("rootSeedEnvName", "VLEI_ROOT_SEED")

    if command == "verify":
        root_aid = expected_root(request, state_dir)
        try:
            return verify_json(
                data.get("envelope"),
                data.get("canonicalPayload", ""),
                root_aid,
                data.get("expectedLei"),
            )
        except Exception:
            return {
                "valid": False,
                "errors": [
                    {
                        "code": "ENVELOPE_MALFORMED",
                        "message": "Envelope is malformed or contains an invalid proof",
                    }
                ],
            }

    root_secret = read_root_secret(env_name)
    if command in ("initialize", "root-aid"):
        with state_lock(state_dir):
            state = initialize_state(state_dir, root_secret)
        return {"rootAid": state["root_aid"]}
    if command == "create-signer":
        return create_signer(state_dir, root_secret, data.get("id"), data.get("info"))
    if command == "sign":
        return sign_json(
            state_dir,
            root_secret,
            data.get("lei"),
            data.get("signerId"),
            data.get("payload"),
            data.get("canonicalPayload", ""),
        )
    raise BridgeError("COMMAND_UNKNOWN", f"Unknown bridge command {command!r}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sandbox-scripts", required=True)
    parser.add_argument("--state-dir", required=True)
    arguments = parser.parse_args()
    try:
        configure_sandbox(arguments.sandbox_scripts)
        request = json.load(sys.stdin)
        result = dispatch(request, os.path.abspath(arguments.state_dir))
        response = {"ok": True, "result": result}
    except BridgeError as error:
        response = {"ok": False, "error": {"code": error.code, "message": str(error)}}
    except Exception:
        response = {
            "ok": False,
            "error": {"code": "INTERNAL_ERROR", "message": "The signing bridge failed unexpectedly"},
        }
    json.dump(response, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
