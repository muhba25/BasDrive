import { createContext, useCallback, useContext, useState } from "react";

type ToastKind = "ok" | "err" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => undefined);

let seq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = seq++;
    setItems((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
