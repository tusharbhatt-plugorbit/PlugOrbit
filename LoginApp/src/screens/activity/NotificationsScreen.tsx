import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {AppNotification} from '../../domain/types';
import {useNavigation} from '../../navigation/NavigationContext';
import {isRouteName} from '../../navigation/routeNames';
import type {RouteName} from '../../navigation/params';
import {useServices} from '../../services';
import {useApp} from '../../store/appStore';
import {colors, radii, spacing, type} from '../../theme';
import {timeAgo} from '../../domain/trust';
import {
  EmptyState,
  Icon,
  PermissionPrompt,
  Screen,
  SectionTitle,
  TextButton,
  useNow,
} from '../../ui';

const DAY = 24 * 60 * 60 * 1000;

/** 37 Notifications. Tapping one marks it read and goes where it points. */
export default function NotificationsScreen(): React.JSX.Element {
  const nav = useNavigation();
  const {notification: service} = useServices();
  const items = useApp(s => s.notifications);
  const now = useNow(60_000);
  const [askedPermission, setAskedPermission] = useState(false);

  const unread = items.filter(n => !n.read).length;
  const sorted = [...items].sort((a, b) => b.at - a.at);
  const today = sorted.filter(n => now - n.at < DAY);
  const earlier = sorted.filter(n => now - n.at >= DAY);

  const open = async (n: AppNotification) => {
    if (!n.read) {
      await service.markRead(n.id);
    }
    // Deep links come from outside the app, so validate before navigating.
    if (n.target && isRouteName(n.target.route)) {
      const name: RouteName = n.target.route;
      (nav.navigate as (r: RouteName, p?: unknown) => void)(
        name,
        n.target.params,
      );
    }
  };

  const group = (title: string, list: AppNotification[]) =>
    list.length === 0 ? null : (
      <View key={title}>
        <SectionTitle title={title} />
        <View style={styles.list}>
          {list.map(n => (
            <Pressable
              key={n.id}
              onPress={() => open(n)}
              accessibilityRole="button"
              accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${
                n.body
              }`}
              style={({pressed}) => [styles.item, pressed && styles.pressed]}>
              <View style={[styles.dot, n.read && styles.dotRead]} />
              <View style={styles.flex}>
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.body}>{n.body}</Text>
                <Text style={styles.time}>{timeAgo(n.at, now)}</Text>
              </View>
              {n.target && (
                <Icon
                  name="chevron-right"
                  size={18}
                  color={colors.placeholder}
                />
              )}
            </Pressable>
          ))}
        </View>
      </View>
    );

  return (
    <Screen
      title="Notifications"
      right={
        unread > 0 ? (
          <TextButton label="Read all" onPress={() => service.markAllRead()} />
        ) : null
      }>
      {!askedPermission && (
        <View style={styles.perm}>
          <PermissionPrompt
            kind="notifications"
            onAllow={() => setAskedPermission(true)}
            onSkip={() => setAskedPermission(true)}
          />
        </View>
      )}
      {items.length === 0 ? (
        <EmptyState
          icon="bell"
          title="You’re all caught up"
          body="Charger-ready alerts, 80% reminders and payment updates show up here."
          primary={{
            label: 'Choose alerts',
            onPress: () => nav.navigate('Alerts'),
          }}
        />
      ) : (
        <>
          {group('Today', today)}
          {group('Earlier', earlier)}
          <View style={styles.center}>
            <TextButton
              label="Choose which alerts you get"
              icon="settings"
              tone="muted"
              onPress={() => nav.navigate('Alerts')}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  list: {gap: spacing.sm},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  pressed: {opacity: 0.88},
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.limeDark,
  },
  dotRead: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
  },
  title: {...type.heading, color: colors.ink},
  body: {...type.caption, color: colors.inkSoft, marginTop: 2, lineHeight: 18},
  time: {...type.caption, color: colors.muted, marginTop: 4, fontSize: 11.5},
  perm: {marginBottom: spacing.md},
  permRow: {flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start'},
  permTitle: {...type.heading, color: colors.ink},
  permBody: {
    ...type.caption,
    color: colors.inkSoft,
    marginTop: 2,
    lineHeight: 18,
  },
  permActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  center: {alignItems: 'center', marginTop: spacing.lg},
});
