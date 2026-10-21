import { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
import { NAVY, ACCENT } from '../tokens';
import CentralInfoDisplay from './CentralInfoDisplay';

type OverlayState = 'recording' | 'transcribing' | 'extracting';

type Props = {
  state: OverlayState;
  durationMs: number;
  customLabel?: string;
};

function Waveform() {
  const bar0 = useRef(new Animated.Value(0.3)).current;
  const bar1 = useRef(new Animated.Value(0.6)).current;
  const bar2 = useRef(new Animated.Value(1.0)).current;
  const bar3 = useRef(new Animated.Value(0.5)).current;
  const bar4 = useRef(new Animated.Value(0.4)).current;
  const bars = [bar0, bar1, bar2, bar3, bar4];
  const durations = [620, 450, 750, 520, 680];

  useEffect(() => {
    const loops = bars.map((bar, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bar, { toValue: 1,   duration: durations[i], useNativeDriver: true }),
          Animated.timing(bar, { toValue: 0.2, duration: durations[i], useNativeDriver: true }),
        ])
      );
      setTimeout(() => loop.start(), i * 80);
      return loop;
    });
    return () => loops.forEach(l => l.stop());
  }, []);

  return (
    <View style={wave.container}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[wave.bar, { transform: [{ scaleY: bar }] }]}
        />
      ))}
    </View>
  );
}

const wave = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
  },
  bar: {
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
});

export default function RecordingOverlay({ state, durationMs, customLabel }: Props) {
  const isRecording = state === 'recording';

  const mm = String(Math.floor(durationMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor(durationMs / 1000) % 60).padStart(2, '0');

  const processingLabel =
    state === 'transcribing' ? 'Transcribing…' :
    state === 'extracting'   ? 'Identifying book…' : '';

  return (
    <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject}>
      <View style={styles.tint} />
      {isRecording ? (
        <CentralInfoDisplay title={customLabel ?? 'Record your new reading note'} paddingHorizontal={32}>
          <Text style={styles.timer}>{mm}:{ss}</Text>
          <Waveform />
        </CentralInfoDisplay>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={NAVY} style={styles.processingSpinner} />
          <Text style={styles.processingLabel}>{processingLabel}</Text>
        </View>
      )}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(246,243,236,0.62)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  timer: {
    fontSize: 56,
    fontWeight: '300',
    color: NAVY,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    marginBottom: 18,
  },
  processingSpinner: {
    marginBottom: 18,
  },
  processingLabel: {
    fontFamily: 'Newsreader_400Regular_Italic',
    fontSize: 20,
    color: NAVY,
    textAlign: 'center',
  },
});
