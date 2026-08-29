import path from "node:path";
import { fileURLToPath } from "node:url";

import { VleiJsonSigning } from "@repo/vlei-json-signing";

if (!process.env.VLEI_ROOT_SEED) {
  process.env.VLEI_ROOT_SEED = "local-smoke-test-only-seed";
  console.warn(
    "VLEI_ROOT_SEED is not set; using a local smoke-test-only seed.",
  );
}


const envelope = JSON.parse(`{
    "v": "VLEIJSON10",
    "payload": {
        "message": "Hello, world!"
    },
    "protected": {
        "v": "VLEIJSON10",
        "payloadDigest": "FNEHziMvVRMx-eISG8ly6qiU_82QIScHOddm_OgS0Fbv",
        "lei": "8755001ELOZEL05BVX22",
        "signerAid": "FPf7f4LEMtnafec0r0P3hzEz1ji9ihE4R3VLUn582eO-",
        "signerCredentialSaid": "FDdB8SwXGOEZLdXIFV0HgIIpP0bPXkL31rNYcR0wBRm0",
        "signedAt": "2026-08-29T05:07:31.645Z"
    },
    "signature": "0BADG17ouY4MCxOX_L7-tF36AhB1wbVHApU9t1dR-h9YoTZrVQyZCSKJHiIBv2ikGeaVxObllzRQS8-xc09-V4gA",
    "signer": {
        "credential": {
            "v": "ACDC10JSON0001f1_",
            "d": "FDdB8SwXGOEZLdXIFV0HgIIpP0bPXkL31rNYcR0wBRm0",
            "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
            "ri": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
            "s": "FEMIF0lmNSYaNF6B_9pJcfz4ByF5BYq_93-nYpIn8E90",
            "a": {
                "d": "FCExb5GAvGOwqaQlh2i5Nfw4q0g1GhXgugBMt-s2GQiz",
                "i": "FPf7f4LEMtnafec0r0P3hzEz1ji9ihE4R3VLUn582eO-",
                "dt": "2026-08-29T05:07:31.431450+00:00",
                "signerId": "signer-d899a1a276bbfd22510b773e5addb7a1",
                "info": {
                    "name": "LuLuGuard Test Signer",
                    "role": "Integration Test"
                }
            }
        },
        "credentialSignature": "0BDDNT2nJbg3TLxRVkM55cTR06AEa0Pv242RyER-j4MdPy4YsQn9BqzfNoJmCZOlyVR4sZinJRYuSxQcZA4lolAK",
        "rootKeyAtIssuance": "DOlpS2JUOaOMGYgu-H4oMP_ra7TUmm_vVyTnNQZFAvYU"
    },
    "proof": {
        "rootAid": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
        "rootKel": [
            {
                "event": {
                    "v": "KERI10JSON00012b_",
                    "t": "icp",
                    "d": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "0",
                    "kt": "1",
                    "k": [
                        "DOlpS2JUOaOMGYgu-H4oMP_ra7TUmm_vVyTnNQZFAvYU"
                    ],
                    "nt": "1",
                    "n": [
                        "FELFLSBi91tCTCcmAQTDpp0_5BlY7-yVHSXfN24pbYNO"
                    ],
                    "bt": "0",
                    "b": [],
                    "c": [],
                    "a": []
                },
                "sig": "0BBr4N0uR4Qwwx8OnBmWSGJIbQOAQGmZm9N97WMIAmUmXk0b9sDaOS_WIlkTReoP4fqpHpFMkEgTNyYvIy8uUCYH"
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FE1WBLMtYb8yEbnYmU7iBIv2l33iWEi9eaWEniIvMRdV",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "1",
                    "p": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "a": [
                        {
                            "i": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
                            "s": "0",
                            "d": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl"
                        }
                    ]
                },
                "sig": "0BC-kYnHUzBuGDOgumZCyGV9hcF1vbh51HzFXRXgXvQaZmJNOGDsd46hQX_sw6oiJg6WIRLYbW6JK6lMlv0-UrcP"
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FAROdzztcJkfY8nvbKN4uZtSZC7b2_dJkQHMmYDdyKi_",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "2",
                    "p": "FE1WBLMtYb8yEbnYmU7iBIv2l33iWEi9eaWEniIvMRdV",
                    "a": [
                        {
                            "i": "FCohv2QKcaGRS0ZQNFq7nIjp8vzWHejyxKSjYrQ9WkNn",
                            "s": "0",
                            "d": "FMhkMKsQmdkg8sVN8TfrQHlDRfl_A7f68LXXpTsNBTW6"
                        }
                    ]
                },
                "sig": "0BAJTECnzLl7xq1uDDVaWBF9fwvNUYTdT6uU7YgZylZ6pa8glmYZgYRVVgOPIHCU89da4rvUY5ba9UBErnds5OQH"
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FD0sHBy8OPLtu_DeLL7x0jQQ2T549LCXvuugH80nE33j",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "3",
                    "p": "FAROdzztcJkfY8nvbKN4uZtSZC7b2_dJkQHMmYDdyKi_",
                    "a": [
                        {
                            "i": "FAoHtSSB4MCEPe_T4l5A2_9gua-rfIRdkDD8sjfOSJRQ",
                            "s": "0",
                            "d": "FMISTy7nWr-visqgVND34UcLMjuO_5Tl76HwusNrLx_E"
                        }
                    ]
                },
                "sig": "0BA-UxOLn0IPTkpfZocqfreVBNwFQL9bP_X1EXkKAVhSmpWAt6MA6NrX4cKbDPViDlSqfO0rzpGNoe6yv0cPFGgB"
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FIzbYvr0lH0Ym-15OenH7MY3RskG0DDTicpeqcuV1U36",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "4",
                    "p": "FD0sHBy8OPLtu_DeLL7x0jQQ2T549LCXvuugH80nE33j",
                    "a": [
                        {
                            "i": "FI5EvcET8AV5za_1vuIODgkXQnC3qKlnOIMkl-YIQFTH",
                            "s": "0",
                            "d": "FJMdeSLNxbpCULK6iD2tfrjewJhEYFcKxAHlfSEEgYAD"
                        }
                    ]
                },
                "sig": "0BDs3Kz2hkNm5_ecIXY7D0CIpZNbuwZrTplKNeKYtzek-JY4HGMt7lTDWScUBAEZHiIsx9wCpLw5x4rfyq76AIUG"
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FE9Hgq_jeow_LeEsAwIiuHUMzGZrz7mbEg6_j4qJPCVE",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "5",
                    "p": "FIzbYvr0lH0Ym-15OenH7MY3RskG0DDTicpeqcuV1U36",
                    "a": [
                        {
                            "i": "FCxJyNAWeY32dzuD71TzW48CUrT-8l7hbJ9WspzRN8wL",
                            "s": "0",
                            "d": "FBDsNZrPIgeaWgoDPvPHOiYyRIkTtn9ceQuS0teHP4sH"
                        }
                    ]
                },
                "sig": "0BC6ISOzMkSFG461tTY41bFUmr11iC0zg7HMmjhM1DQq0629YkAgAXKBLWACpC5Dws6Tz8cm0ZUXjTjfDhBThkMP"
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FBuksE8n6aaW7jp0B_VqHH4zUG6ysDnXixvYwEWIyL_M",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "6",
                    "p": "FE9Hgq_jeow_LeEsAwIiuHUMzGZrz7mbEg6_j4qJPCVE",
                    "a": [
                        {
                            "i": "FDdB8SwXGOEZLdXIFV0HgIIpP0bPXkL31rNYcR0wBRm0",
                            "s": "0",
                            "d": "FGRX9K40mPFihC8Q4ogIEQzjAsZR57MMH5IY57W_oHra"
                        }
                    ]
                },
                "sig": "0BACiVk9EzoNqRcDYjTLkMjGxKHwapzzWUKJWgyjUly7CDMmneTyTBwofGJn5O4-SZPeWU9Hw-wuueQwkdBsrDQA"
            }
        ],
        "signerKel": [
            {
                "event": {
                    "v": "KERI10JSON00015f_",
                    "t": "dip",
                    "d": "FPf7f4LEMtnafec0r0P3hzEz1ji9ihE4R3VLUn582eO-",
                    "i": "FPf7f4LEMtnafec0r0P3hzEz1ji9ihE4R3VLUn582eO-",
                    "s": "0",
                    "kt": "1",
                    "k": [
                        "DK2uwf7NIVADrY_IrxwHpsbJRkcvf_ZeA-_oItW6Hfb0"
                    ],
                    "nt": "1",
                    "n": [
                        "FI1rQQr9QpLxmUcEYg9LF4u1Rdu6hvks9vyKgGpwg2Io"
                    ],
                    "bt": "0",
                    "b": [],
                    "c": [],
                    "a": [],
                    "di": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT"
                },
                "sig": "0BCXEb85vt0qmIFgdU8N9PwGtBZagZhnrXIOjiJFsupE4mMvhfbuLiYWGzQYVXL453zkYMy2qQ15WQCjgL0U_REP"
            }
        ],
        "registry": {
            "v": "KERI10JSON0000ff_",
            "t": "vcp",
            "d": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
            "i": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
            "ii": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
            "s": "0",
            "c": [
                "NB"
            ],
            "bt": "0",
            "b": [],
            "n": "0ADVQVfNizxwmc9KxzUZA8Mz"
        },
        "credentialTel": [
            {
                "v": "KERI10JSON0000ed_",
                "t": "iss",
                "d": "FGRX9K40mPFihC8Q4ogIEQzjAsZR57MMH5IY57W_oHra",
                "i": "FDdB8SwXGOEZLdXIFV0HgIIpP0bPXkL31rNYcR0wBRm0",
                "s": "0",
                "ri": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
                "dt": "2026-08-29T05:07:31.432236+00:00"
            }
        ]
    },
    "signerId": "signer-d899a1a276bbfd22510b773e5addb7a1"
}`)

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const stateDir = path.resolve(
  repositoryRoot,
  process.env.VLEI_STATE_DIR ?? ".vlei-json-signing",
);

const signing = new VleiJsonSigning({
  stateDir,
});

const { rootAid } = await signing.initialize();

const verification = await signing.verifyJson(envelope, {
  expectedRootAid: rootAid,
});

if (!verification.valid) {
  console.error("Verification failed:", verification.errors);
  process.exitCode = 1;
} else {
  console.log("Verification: PASS");
  console.log("Verified signer info:", verification.signer.info);
}
