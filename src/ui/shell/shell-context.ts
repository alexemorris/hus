import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ShellController } from './shell-controller.ts';

export const ShellContext = createContext<ShellController | null>(null);

export function useShell(): ShellController {
  const ctl = useContext(ShellContext);
  if (!ctl) throw new Error('useShell() must be used inside <ShellContext.Provider>');
  return ctl;
}
