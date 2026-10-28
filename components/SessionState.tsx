"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

type SessionStateContextValue = {
  values: Map<string, unknown>;
  setValue: <T>(
    key: string,
    initialValue: T,
    update: SetStateAction<T>,
  ) => void;
};

const SessionStateContext = createContext<SessionStateContextValue | null>(null);

export function SessionStateProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Map<string, unknown>>(() => new Map());
  const setValue = useCallback<SessionStateContextValue["setValue"]>(
    (key, initialValue, update) => {
      setValues((current) => {
        const next = new Map(current);
        const previous = current.has(key) ? current.get(key) as typeof initialValue : initialValue;
        const value = typeof update === "function"
          ? (update as (currentValue: typeof initialValue) => typeof initialValue)(previous)
          : update;
        next.set(key, value);
        return next;
      });
    },
    [],
  );

  return (
    <SessionStateContext.Provider value={{ values, setValue }}>
      {children}
    </SessionStateContext.Provider>
  );
}

export function useSessionState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(SessionStateContext);
  if (!context) throw new Error("useSessionState harus digunakan di dalam SessionStateProvider.");

  const { values, setValue: setContextValue } = context;
  const value = (values.has(key) ? values.get(key) : initialValue) as T;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (update) => setContextValue(key, initialValue, update),
    [initialValue, key, setContextValue],
  );

  return [value, setValue];
}
