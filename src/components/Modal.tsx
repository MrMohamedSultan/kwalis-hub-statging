import React, { useId } from "react";

import { useFocusTrap } from "@/hooks/use-focus-trap";

export function Modal({
  onClose,
  title,
  children,
  dismissible = true,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** When false, backdrop clicks, Escape and the ✕ button are ignored (e.g. while saving). */
  dismissible?: boolean;
}) {
  const titleId = useId();
  const handleClose = React.useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);
  const containerRef = useFocusTrap(true, handleClose);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-50 p-6"
      onClick={handleClose}
    >
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl border border-border p-6 max-w-2xl w-full max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={!dismissible}
            aria-label="Close dialog"
            className="opacity-70 hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
