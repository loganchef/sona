import { createContext, useContext, type ReactNode } from 'react';
import type { SurfaceStyle } from '@/types';

const SurfaceContext = createContext<SurfaceStyle>('solid');

export interface SurfaceProviderProps {
  surface: SurfaceStyle;
  children: ReactNode;
}

/**
 * Makes the active surface treatment available to every panel without
 * threading the setting through each component.
 */
export function SurfaceProvider({ surface, children }: SurfaceProviderProps) {
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

export function useSurface() {
  return useContext(SurfaceContext);
}

export function useIsGlass() {
  return useContext(SurfaceContext) === 'glass';
}