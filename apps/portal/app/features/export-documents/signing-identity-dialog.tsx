import { Button } from "@luluguard/ui/components/button";
import { Input } from "@luluguard/ui/components/input";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { SigningIdentity } from "./signing-client";

export function SigningIdentityDialog({
  defaultValues,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  defaultValues: SigningIdentity;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (identity: SigningIdentity) => void;
}) {
  const [lei, setLei] = useState(defaultValues.lei);
  const [signer, setSigner] = useState(defaultValues.signer);
  const [role, setRole] = useState(defaultValues.role);

  const canConfirm = lei.trim() && signer.trim() && role.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        aria-labelledby="signing-identity-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-xl"
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p
              className="font-display text-lg font-bold"
              id="signing-identity-title"
            >
              確認簽署人資訊
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              送出前請確認用於 vLEI 簽章的 LEI、簽署人與職稱（已預填 demo 預設值，可自行修改）。
            </p>
          </div>
          <button
            aria-label="關閉"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="LEI">
            <Input onChange={(event) => setLei(event.target.value)} value={lei} />
          </Field>
          <Field label="簽署人">
            <Input onChange={(event) => setSigner(event.target.value)} value={signer} />
          </Field>
          <Field label="職稱">
            <Input onChange={(event) => setRole(event.target.value)} value={role} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={isSubmitting} onClick={onCancel} type="button" variant="outline">
            取消
          </Button>
          <Button
            disabled={isSubmitting || !canConfirm}
            onClick={() =>
              onConfirm({ lei: lei.trim(), signer: signer.trim(), role: role.trim() })
            }
            type="button"
          >
            {isSubmitting ? "簽章送出中…" : "確認並送出簽章"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
