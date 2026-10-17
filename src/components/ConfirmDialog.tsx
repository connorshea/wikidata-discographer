import { useEffect, useId, useRef, useState } from "react";

export interface Confirm {
  title: string;
  body: string;
  action: string;
}

/**
 * A modal dialog asking before something that replaces the form. It's open
 * while `confirm` is set. Closing it any way (Cancel, Escape, the backdrop)
 * calls `onClose`, which should clear `confirm`.
 */
export function ConfirmDialog({
  confirm,
  onConfirm,
  onClose,
}: {
  confirm: Confirm | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const isOpen = confirm !== null;
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (isOpen && !d.open) {
      d.showModal();
      // Enter on the default focus shouldn't destroy anything.
      cancel.current?.focus();
    } else if (!isOpen && d.open) d.close();
  }, [isOpen]);
  const close = () => dialog.current?.close();
  return (
    <dialog
      ref={dialog}
      className="confirm"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself; its contents are
      // wrapped in a div that fills it, so clicks inside never do.
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      {confirm && (
        <div className="confirm-body">
          <h2 id={titleId}>{confirm.title}</h2>
          <p id={bodyId}>{confirm.body}</p>
          <div className="row">
            <button ref={cancel} type="button" className="ghost" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                close();
                onConfirm();
              }}
            >
              {confirm.action}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** A button that replaces the form, asking first in a modal dialog when that
 * would throw away what's filled in. */
export function ConfirmButton({
  label,
  className,
  disabled,
  describedBy,
  children,
  confirm,
  onConfirm,
}: {
  label: string;
  className: string;
  disabled?: boolean;
  /** The id of a hint that says why it's disabled. */
  describedBy?: string;
  /** Shown before the label, such as an icon. */
  children?: React.ReactNode;
  confirm: Confirm | null;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => (confirm ? setAsking(true) : onConfirm())}
      >
        {children}
        {label}
      </button>
      <ConfirmDialog
        confirm={asking ? confirm : null}
        onConfirm={onConfirm}
        onClose={() => {
          setAsking(false);
          button.current?.focus();
        }}
      />
    </>
  );
}
