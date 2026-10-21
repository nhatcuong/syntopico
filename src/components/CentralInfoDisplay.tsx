import { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAVY } from '../tokens';

type Props = {
  title: string;
  paddingHorizontal?: number;
  children: ReactNode;
};

// Fixed distance below the safe-area top inset — deliberately NOT centered
// via flex — so the title lands at the exact same screen position in every
// usage, regardless of how much content (a short subtitle vs. a timer +
// waveform) follows it below the divider. Centering was the original bug:
// it made the title's position depend on the total height of whatever
// followed it, which differs between usages.
const TOP_OFFSET_FROM_SAFE_AREA = 288;

// Renders as an absolutely-positioned overlay, so it must be placed as a
// direct child of a container that covers the true screen (ignoring safe
// area insets) rather than one already inset-adjusted — e.g. a direct
// child of a SafeAreaView (matching RecordingOverlay's own BlurView, which
// covers the true full screen including the status bar). insets.top is
// added back in explicitly above so the result still respects the actual
// device safe area rather than assuming a fixed value.
export default function CentralInfoDisplay({ title, paddingHorizontal = 64, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { top: insets.top + TOP_OFFSET_FROM_SAFE_AREA, paddingHorizontal }]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.divider} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Newsreader_500Medium',
    fontSize: 22,
    color: NAVY,
    textAlign: 'center',
    marginBottom: 12,
  },
  divider: {
    width: 80,
    height: 1,
    backgroundColor: 'rgba(27,42,74,0.3)',
    marginBottom: 20,
  },
});
