import { Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Fab from './Fab';
import RecordingOverlay from './RecordingOverlay';
import { useFabConfig } from '../contexts/FabController';

// Rendered once, as a sibling of the Stack.Navigator (see App.tsx) — not
// inside any individual screen — so it's a single component instance that
// screen push/pop transitions never touch. This container isn't nested in
// any SafeAreaView. Android draws edge-to-edge, so its navigation/taskbar
// inset must be added explicitly. Keep the existing iOS screen-edge spacing.
export default function GlobalRecordingUI() {
  const { fabState, onPress, overlay } = useFabConfig();
  const insets = useSafeAreaInsets();
  const bottom = 30 + (Platform.OS === 'android' ? insets.bottom : 0);

  return (
    <>
      {overlay && (
        <RecordingOverlay
          state={overlay.state}
          durationMs={overlay.durationMs}
          customLabel={overlay.customLabel}
        />
      )}
      <View style={[styles.fabContainer, { bottom }]} pointerEvents="box-none">
        <Fab fabState={fabState} onPress={onPress} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    alignSelf: 'center',
  },
});
