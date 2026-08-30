import { VleiJsonSigning } from "@repo/vlei-json-signing";

const EXPECTED_ROOT_AID = "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT";

const envelope = JSON.parse(`{
    "v": "VLEIJSON-1.0",
    "payload": {
        "message": "Hello, world!"
    },
    "protected": {
        "v": "VLEIJSON-1.0",
        "payloadDigest": "FNEHziMvVRMx-eISG8ly6qiU_82QIScHOddm_OgS0Fbv",
        "lei": "8755001ELOZEL05BVX22",
        "signerAid": "FAOrOTz-3P8q-GORnzN7gTJhYVv2a23gQPs98u56aKX8",
        "signerCredentialSaid": "FKWf63M7dj8WT1fLhCusrGDkqsjBaUq_Mke1LUvtyHYy",
        "signedAt": "2026-08-29T05:45:27.292Z"
    },
    "signature": "0BCxcNv-zmV1FfC93WmzoVc0oVgM04sVQ6Ad2fv0gtg1nEzToB_PcjYErpJ69Pw-sXbXLcIi8nGVAbmVkf622kAB",
    "signer": {
        "credential": {
            "v": "ACDC10JSON0001d4_",
            "d": "FKWf63M7dj8WT1fLhCusrGDkqsjBaUq_Mke1LUvtyHYy",
            "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
            "ri": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
            "s": "FEMIF0lmNSYaNF6B_9pJcfz4ByF5BYq_93-nYpIn8E90",
            "a": {
                "d": "FF4TJn0SjckqHZcM-4s6t8HVeOaCNhSFZPEEuA-8b8MI",
                "i": "FAOrOTz-3P8q-GORnzN7gTJhYVv2a23gQPs98u56aKX8",
                "dt": "2026-08-29T05:43:35.640585+00:00",
                "signerId": "signer-ef6e6b1c3cd42537affc63a9d3376f82",
                "info": {
                    "name": "CT",
                    "role": "Tester"
                }
            }
        },
        "credentialSignature": "0BAfnTzYVkc9kyRhwvHoUp-N_Do72A7P79G0X__lAic7e_v5htgjYM_8ppiggnA24tV-jLILdGpQkcbhkLPz0d8F",
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
            },
            {
                "event": {
                    "v": "KERI10JSON00013a_",
                    "t": "ixn",
                    "d": "FDafMYjB28xDgZTrm4S3LjmR1JIcli0HTMgi7hFB_C4C",
                    "i": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT",
                    "s": "7",
                    "p": "FBuksE8n6aaW7jp0B_VqHH4zUG6ysDnXixvYwEWIyL_M",
                    "a": [
                        {
                            "i": "FKWf63M7dj8WT1fLhCusrGDkqsjBaUq_Mke1LUvtyHYy",
                            "s": "0",
                            "d": "FN0_QJbnZslnTghblym10-Fsxv2m3Jww2IPPHR6S_faz"
                        }
                    ]
                },
                "sig": "0BBhaF8MHFsroS6X8r8q96t0ARZo4yZT4GFJj4yxBgRpJe9xWX8SQyoxFKPqWh7IE8YS0shvh2yj4FyiqXXBlZkC"
            }
        ],
        "signerKel": [
            {
                "event": {
                    "v": "KERI10JSON00015f_",
                    "t": "dip",
                    "d": "FAOrOTz-3P8q-GORnzN7gTJhYVv2a23gQPs98u56aKX8",
                    "i": "FAOrOTz-3P8q-GORnzN7gTJhYVv2a23gQPs98u56aKX8",
                    "s": "0",
                    "kt": "1",
                    "k": [
                        "DJ2mgSIItWEpzZ8G9Z_EFK34gI_WCg16Sp-Brn74-xAN"
                    ],
                    "nt": "1",
                    "n": [
                        "FEoyzJ4cI1DoJDkFNkl8ElO-1AEWr1hzrBnpHC6G6Mkw"
                    ],
                    "bt": "0",
                    "b": [],
                    "c": [],
                    "a": [],
                    "di": "FCIErP8b3nCca-rMn5LW4Tf2GzfUB67pdc5OjrhpMWkT"
                },
                "sig": "0BDL1Rtf6IQP_ebWN6-3c_7rfEAi8PaVHl8PNuBH6XwTQfOrXevucgGAV4JkoFDy22X372GAh_fr4M2ucIobs4EJ"
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
                "d": "FN0_QJbnZslnTghblym10-Fsxv2m3Jww2IPPHR6S_faz",
                "i": "FKWf63M7dj8WT1fLhCusrGDkqsjBaUq_Mke1LUvtyHYy",
                "s": "0",
                "ri": "FAVJCFe_XPlHilO9Sr1kw4g4bHSQdc0imqEj1pZaBFOl",
                "dt": "2026-08-29T05:43:35.644709+00:00"
            }
        ]
    },
    "signerId": "signer-ef6e6b1c3cd42537affc63a9d3376f82"
}`);

const verification = await VleiJsonSigning.verifyJson(envelope, {
  expectedRootAid: EXPECTED_ROOT_AID,
});

if (!verification.valid) {
  console.error("Verification failed:", verification.errors);
  process.exitCode = 1;
} else {
  console.log("Verification: PASS");
  console.log("Verified LEI:", verification.lei);
  console.log("Verified signer info:", verification.signer.info);
  console.log("Verified payload:\n", JSON.stringify(verification.payload, null, 2));
}
