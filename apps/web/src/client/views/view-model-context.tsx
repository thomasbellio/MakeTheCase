'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * A React context for one screen's ViewModel (AGENTS.md section 9.1). The
 * screen creates the ViewModel, provides it, and disposes it on unmount;
 * Views below read it with the hook and never construct their own.
 */
export function createViewModelContext<T>(name: string) {
  const Context = createContext<T | null>(null);

  function Provider({ value, children }: { value: T; children: ReactNode }) {
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useViewModel(): T {
    const value = useContext(Context);
    if (value === null) throw new Error(`${name} is used outside its provider`);
    return value;
  }

  return [Provider, useViewModel] as const;
}
