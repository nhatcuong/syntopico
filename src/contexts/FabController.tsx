import { createContext, useContext, useState, ReactNode } from 'react';
import type { FabState } from '../components/Fab';

export type FabOverlayConfig = {
  state: 'recording' | 'transcribing' | 'extracting';
  durationMs: number;
  customLabel?: string;
};

export type FabConfig = {
  fabState: FabState;
  onPress: () => void;
  overlay: FabOverlayConfig | null;
};

const IDLE_CONFIG: FabConfig = {
  fabState: 'idle',
  onPress: () => {},
  overlay: null,
};

const FabConfigContext = createContext<FabConfig>(IDLE_CONFIG);
const SetFabConfigContext = createContext<(config: FabConfig) => void>(() => {});

// One FAB + one RecordingOverlay, rendered once above the navigator (see
// GlobalRecordingUI), rather than each screen owning its own instance.
// Screens register "what pressing the FAB should currently do" via
// useFabConfig — see HomeScreen/BookScreen's useFocusEffect calls — so the
// FAB is a single component that's simply never unmounted or re-animated
// by screen transitions, and its position only ever needs to be computed
// (and get safe-area handling right) in exactly one place.
export function FabControllerProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<FabConfig>(IDLE_CONFIG);
  return (
    <SetFabConfigContext.Provider value={setConfig}>
      <FabConfigContext.Provider value={config}>
        {children}
      </FabConfigContext.Provider>
    </SetFabConfigContext.Provider>
  );
}

export function useFabConfig() {
  return useContext(FabConfigContext);
}

// Call from a screen's useFocusEffect (not a plain useEffect — only the
// currently-focused screen should be allowed to drive the shared FAB).
export function useSetFabConfig() {
  return useContext(SetFabConfigContext);
}
