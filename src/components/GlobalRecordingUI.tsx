import { View, StyleSheet } from 'react-native';
import Fab from './Fab';
import RecordingOverlay from './RecordingOverlay';
import { useFabConfig } from '../contexts/FabController';

// Rendered once, as a sibling of the Stack.Navigator (see App.tsx) — not
// inside any individual screen — so it's a single component instance that
// screen push/pop transitions never touch. This container isn't nested in
// any SafeAreaView, so — same as the per-screen FABs it replaced, which sat
// as direct (absolutely-positioned) SafeAreaView children and so didn't
// inherit its inset — bottom:30 is already relative to the true screen
// edge; adding insets.bottom on top of it here double-counts the inset.
export default function GlobalRecordingUI() {
  const { fabState, onPress, overlay } = useFabConfig();

  return (
    <>
      {overlay && (
        <RecordingOverlay
          state={overlay.state}
          durationMs={overlay.durationMs}
          customLabel={overlay.customLabel}
        />
      )}
      <View style={styles.fabContainer} pointerEvents="box-none">
        <Fab fabState={fabState} onPress={onPress} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
  },
});
