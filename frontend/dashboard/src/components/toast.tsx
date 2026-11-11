import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { IconAlert, IconCheck, IconX } from "./Icons";

/** Consistent, non-blocking feedback for completed actions (polite live region, auto-dismiss). */
type Tone = "success" | "error";
interface Toast { id: number; message: string; tone: Tone }

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((message: string, tone: Tone = "success") => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
  }, [dismiss]);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === "success" ? <IconCheck size={16} /> : <IconAlert size={16} />}
            <span>{t.message}</span>
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}><IconX size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
