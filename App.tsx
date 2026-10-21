import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import {
  useFonts,
  Newsreader_400Regular,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium_Italic,
  Newsreader_600SemiBold_Italic,
} from '@expo-google-fonts/newsreader';
import { Bellefair_400Regular } from '@expo-google-fonts/bellefair';
import { initDatabase } from './src/db/database';
import HomeScreen from './src/screens/HomeScreen';
import BookScreen from './src/screens/BookScreen';
import { RootStackParamList } from './src/navigation/types';
import { FabControllerProvider } from './src/contexts/FabController';
import GlobalRecordingUI from './src/components/GlobalRecordingUI';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: process.env.APP_VARIANT !== 'development',
});

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [fontsLoaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium_Italic,
    Newsreader_600SemiBold_Italic,
    Bellefair_400Regular,
  });

  useEffect(() => {
    initDatabase();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <FabControllerProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Book" component={BookScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        {/* Sibling of the navigator, not inside any screen — one FAB and
            one RecordingOverlay instance for the whole app, unaffected by
            screen push/pop transitions. See FabController/GlobalRecordingUI. */}
        <GlobalRecordingUI />
      </FabControllerProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
