"use client";
import { createContext, useCallback, useContext, useState } from "react";

type ConfirmOpts = { title?: string; confirmLabel?: string; danger?: boolean };
type Fn = (message: string, opts?: ConfirmOpts) => Promise<boolean>;

const Ctx = createContext<Fn>(async () => false);
export const useConfirm = () => useContext(Ctx);

/** App-wide custom confirmation dialog (replaces the native browser confirm). */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ message: string; opts: ConfirmOpts; resolve: (b: boolean) => void } | null>(null);

  const confirm = useCallback<Fn>((message, opts = {}) => new Promise<boolean>((resolve) => {
    setState({ message, opts, resolve });
  }), []);

  function close(b: boolean) {
    state?.resolve(b);
    setState(null);
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.opts.title ?? "Confirm"}>
          <div className="modal card">
            {state.opts.title && <h3 style={{ margin: "0 0 6px" }}>{state.opts.title}</h3>}
            <p style={{ margin: "0 0 14px", overflowWrap: "anywhere" }}>{state.message}</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost sm" onClick={() => close(false)}>Cancel</button>
              <button type="button" className={`btn sm${state.opts.danger ? " danger" : ""}`} onClick={() => close(true)} autoFocus>{state.opts.confirmLabel ?? "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
