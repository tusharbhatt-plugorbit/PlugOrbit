import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAssistant } from '../assistant/runtime';
import { assistantStore, useAssistantState } from '../assistant/store';
import {
  useNavigation,
  useNavigationState,
} from '../navigation/NavigationContext';
import type { RouteName } from '../navigation/params';
import { REGISTRY } from '../navigation/registry';
import { Conversation } from '../screens/assistant/AssistantScreen';
import {
  statusText,
  useAssistantOpened,
  useAssistantView,
} from '../screens/assistant/useAssistantView';
import { colors, elevation, radii, sizes, spacing, type } from '../theme';
import {
  BottomSheet,
  Composer,
  ConsentCard,
  ContextChip,
  Icon,
  MicButton,
  PermissionNote,
  RoundAction,
  TextButton,
  VoiceOrb,
} from '../ui';
import { useKeyboardVisible } from '../ui/useKeyboardVisible';
import { useApp } from '../store/appStore';

/**
 * Where the compact Orbit Assist entry point shows (the Map has its own button in its control stack), and how far above the
 * bottom edge it sits so it never covers a screen's own bottom button or the
 * map's list pill.
 */
const FLOAT_LIFT: Partial<Record<RouteName, number>> = {
  Home: 0,
  Trips: 0,
  StationList: 96,
  RoutePlanner: 96,
  RouteResult: 96,
  Navigation: 0,
  BackupAlert: 96,
  EnergyPlanner: 96,
  MultiStop: 96,
  SmartDrive: 96,
  SmartDriveStop: 96,
};

const SESSION_BANNER_LIFT = 64;

/** The small floating button. Opens the assistant sheet without leaving the screen. */
export function FloatingAssistant() {
  const { width } = useWindowDimensions();
  const { current, depth } = useNavigationState();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const phase = useAssistantState(s => s.phase);
  const sheetOpen = useAssistantState(s => s.sheetOpen);
  const hasSession = useApp(s => s.session !== null);
  const lift = FLOAT_LIFT[current];
  if (
    lift === undefined ||
    keyboard ||
    sheetOpen ||
    (current === 'Home' && width < 360)
  ) {
    return null;
  }
  const tabBarVisible = depth === 0 || !!REGISTRY[current]?.tabBar;
  const bottom =
    (tabBarVisible ? sizes.tabBar + insets.bottom : insets.bottom) +
    spacing.lg +
    lift +
    (hasSession ? SESSION_BANNER_LIFT : 0);
  const live = phase !== 'idle';
  return (
    <View style={[styles.floatWrap, { bottom }]} pointerEvents="box-none">
      <Pressable
        onPress={() => assistantStore.set({ sheetOpen: true })}
        accessibilityRole="button"
        accessibilityLabel={
          live ? 'Orbit Assist is active. Open it' : 'Open Orbit Assist'
        }
        testID="floating-assistant"
        style={({ pressed }) => [
          styles.fab,
          elevation(3),
          pressed && { opacity: 0.9 },
        ]}
      >
        <Icon
          name={
            phase === 'listening'
              ? 'mic'
              : phase === 'speaking'
              ? 'volume2'
              : 'sparkles'
          }
          size={24}
          color={colors.lime}
        />
        {live && <View style={styles.liveDot} />}
      </Pressable>
    </View>
  );
}

/** The expandable sheet: the conversation over whatever screen the driver is on. */
export function AssistantSheet() {
  const open = useAssistantState(s => s.sheetOpen);
  const view = useAssistantView();
  const nav = useNavigation();
  const { assistant, settings } = view;
  useAssistantOpened(open);

  const close = async () => {
    assistantStore.set({ sheetOpen: false });
    await assistant.interrupt();
  };
  const openFull = () => {
    assistantStore.set({ sheetOpen: false });
    nav.navigate('Assistant');
  };
  const recent = view.messages.slice(-5);

  return (
    <BottomSheet
      visible={open}
      onClose={close}
      title="Orbit Assist"
      testID="assistant-sheet"
      footer={
        !view.consented ? undefined : settings.drivingMode ? (
          <View style={styles.drivingFooter}>
            <MicButton
              phase={view.phase}
              size={96}
              disabled={!view.canListen}
              onPress={view.toggleMic}
            />
            <Text style={styles.drivingStatus} accessibilityLiveRegion="polite">
              {statusText(view)}
            </Text>
          </View>
        ) : (
          <View style={styles.footer}>
            <Composer
              onSend={view.send}
              disabled={!view.consented}
              placeholder={
                view.consented ? 'Type to Orbit' : 'Turn on Orbit’s AI first'
              }
            />
            <View style={styles.controls}>
              <SheetStatus view={view} />
              <RoundAction
                icon="circle-stop"
                label="Stop talking"
                disabled={
                  view.phase !== 'speaking' && view.phase !== 'thinking'
                }
                onPress={() => assistant.interrupt()}
              />
              <MicButton
                phase={view.phase}
                disabled={!view.canListen}
                onPress={view.toggleMic}
              />
            </View>
          </View>
        )
      }
    >
      <View style={styles.context}>
        {view.context.map(c => (
          <ContextChip key={c.text} icon={c.icon} text={c.text} />
        ))}
      </View>
      {!view.consented ? (
        <ConsentCard onAccept={() => assistant.grantConsent()} />
      ) : recent.length === 0 ? (
        <Text style={styles.empty}>
          Ask Orbit about your battery, the route or a charger. Tap the
          microphone, or type.
        </Text>
      ) : (
        <Conversation view={view} messages={recent} />
      )}
      <PermissionNote
        state={view.microphone}
        onOpenSettings={view.openPhoneSettings}
      />
      <View style={styles.sheetLinks}>
        <TextButton
          label="Open full conversation"
          icon="arrow-right"
          onPress={openFull}
        />
        <TextButton
          label={settings.drivingMode ? 'Leave driving mode' : 'Driving mode'}
          icon="car"
          onPress={() =>
            assistantStore.set(s => ({
              settings: { ...s.settings, drivingMode: !s.settings.drivingMode },
            }))
          }
        />
      </View>
    </BottomSheet>
  );
}

/** Orb and one line of status, for the sheet's control row. */
function SheetStatus({ view }: { view: ReturnType<typeof useAssistantView> }) {
  return (
    <View style={styles.mini}>
      <VoiceOrb phase={view.phase} level={view.level} size={52} />
      <Text
        style={styles.miniText}
        numberOfLines={3}
        accessibilityLiveRegion="polite"
      >
        {statusText(view)}
      </Text>
    </View>
  );
}

/** Mounted once, over every screen: the floating button and its sheet. */
export function AssistantOverlay() {
  getAssistant();
  return (
    <>
      <FloatingAssistant />
      <AssistantSheet />
    </>
  );
}

const styles = StyleSheet.create({
  floatWrap: { position: 'absolute', right: spacing.lg },
  fab: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.limeHaloBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.lime,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  footer: { gap: spacing.md },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mini: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  miniText: { ...type.caption, color: colors.inkSoft, flex: 1 },
  context: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  empty: { ...type.body, color: colors.inkSoft, lineHeight: 20 },
  sheetLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drivingFooter: { alignItems: 'center', gap: spacing.md },
  drivingStatus: { ...type.title, color: colors.ink, textAlign: 'center' },
});
