"use client";

import { useEffect, useRef, useState, type JSX } from "react";

type AuthorizationOrder = {
  orderId: string;
  importer: {
    name: string;
    lei: string;
  };
};

type LetterOfAuthorizationProps = {
  order?: AuthorizationOrder;
  signerName: string;
  signerRole: string;
  onClose: () => void;
  onConfirm: (acceptedAt: string) => void;
};

export function LetterOfAuthorization({
  order,
  signerName,
  signerRole,
  onClose,
  onConfirm,
}: LetterOfAuthorizationProps): JSX.Element | null {
  const [hasReadToEnd, setHasReadToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();

    const documentElement = documentRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (
        documentElement &&
        documentElement.scrollHeight <= documentElement.clientHeight + 2
      ) {
        setHasReadToEnd(true);
      }
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!order) return null;

  function handleDocumentScroll() {
    const element = documentRef.current;
    if (!element) return;

    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= 24) setHasReadToEnd(true);
  }

  return (
    <div className="authorization-overlay" role="presentation">
      <section
        className="authorization-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="authorization-title"
        aria-describedby="authorization-summary"
      >
        <header className="authorization-header">
          <div>
            <p className="section-kicker">CUSTOMS AUTHORIZATION</p>
            <h2 id="authorization-title" ref={titleRef} tabIndex={-1}>
              報關委任書
            </h2>
            <p id="authorization-summary">
              請閱讀完整內容。你同意後，系統才會把本訂單文件提供給報關行。
            </p>
          </div>
          <button
            type="button"
            className="authorization-close"
            aria-label="關閉委託書"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="authorization-progress" aria-hidden="true">
          <span className="done">1</span>
          <i />
          <span>2</span>
          <p>閱讀委託書</p>
          <p>確認並送出</p>
        </div>

        <div
          className="authorization-document"
          ref={documentRef}
          onScroll={handleDocumentScroll}
          tabIndex={0}
        >
          <div className="authorization-document-heading">
            <span>委託書編號</span>
            <strong>LOA-{order.orderId}</strong>
            <small>版本 1.0 · 單次委託</small>
          </div>

          <dl className="authorization-parties">
            <div>
              <dt>委任人（進口商）</dt>
              <dd>{order.importer.name}</dd>
              <small>LEI {order.importer.lei}</small>
            </div>
            <div>
              <dt>受任人</dt>
              <dd>本平台媒合之合作報關行</dd>
              <small>實際業者將於詢價結果中揭露</small>
            </div>
            <div>
              <dt>適用案件</dt>
              <dd>{order.orderId}</dd>
              <small>僅限本訂單相關文件與報關作業</small>
            </div>
          </dl>

          <div className="authorization-copy">
            <section>
              <h3>一、委託事項</h3>
              <p>
                委任人授權受任人於本訂單範圍內，接收並檢視商業發票、裝箱單、運輸及其他已上傳文件，進行稅則與稅費初步檢核、缺件確認、報關服務估價，以及後續經委任人另行確認之報關作業。
              </p>
            </section>
            <section>
              <h3>二、文件與資料使用</h3>
              <p>
                文件僅得用於本案詢價、法令遵循檢查及報關準備；受任人應採取合理安全措施，且不得將資料用於與本案無關之目的。依法令或主管機關要求提供者，不在此限。
              </p>
            </section>
            <section>
              <h3>三、授權限制</h3>
              <ul>
                <li>本次同意僅授權傳送文件與取得報關服務報價。</li>
                <li>不包含付款、修改原始文件或代為承諾額外費用。</li>
                <li>正式申報與付款仍須依後續流程取得個別明確核准。</li>
              </ul>
            </section>
            <section>
              <h3>四、效力與撤回</h3>
              <p>
                本委託自電子同意送出時生效，適用至本訂單報關作業完成或委任人撤回為止。撤回不影響受任人於收到通知前已依法完成之作業。
              </p>
            </section>
            <aside>
              本畫面為作業授權紀錄；實際權利義務仍以適用法令、報關行揭露資訊及雙方約定為準。
            </aside>
          </div>
        </div>

        <footer className="authorization-footer">
          <label className={`authorization-consent ${!hasReadToEnd ? "locked" : ""}`}>
            <input
              type="checkbox"
              checked={accepted}
              disabled={!hasReadToEnd}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              <strong>我已閱讀並同意上述委託內容</strong>
              <small>
                同意人：{signerName}（{signerRole}）· 將以 vLEI 簽署並記錄
              </small>
            </span>
          </label>
          {!hasReadToEnd && (
            <p className="authorization-read-hint">請向下閱讀至文件底部以繼續</p>
          )}
          <div className="authorization-actions">
            <button type="button" className="text-button" onClick={onClose}>
              返回
            </button>
            <button
              type="button"
              disabled={!accepted}
              onClick={() => onConfirm(new Date().toISOString())}
            >
              同意、附上委任書並送交報關行
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
