"use client";

import type { ReactNode } from "react";

/** A form submit button that asks for confirmation first — used for the
 * irreversible admin actions on the assessment detail page (document
 * delete). Just a confirm() guard; the actual action is a normal Server
 * Action on the enclosing <form>. */
export function ConfirmSubmitButton({
  confirmMessage,
  className,
  children,
}: {
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
