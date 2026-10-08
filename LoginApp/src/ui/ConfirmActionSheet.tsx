import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, radii, spacing, type} from '../theme';
import {BottomSheet} from './BottomSheet';
import {PrimaryButton, SecondaryButton} from './Buttons';
import {Icon, IconName} from './Icon';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (remove, erase, sign out). */
  tone?: 'default' | 'danger';
  icon?: IconName;
  /** Disables dismissing and shows a spinner on the confirm button. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content between the body and the buttons (a Notice, a list). */
  children?: React.ReactNode;
};

/**
 * The shared "are you sure?" bottom sheet: icon, plain-language consequence,
 * a clear primary action and an always-available way out.
 */
export function ConfirmActionSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  icon,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const danger = tone === 'danger';
  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      title={title}
      dismissable={!loading}
      footer={
        <>
          <PrimaryButton
            label={confirmLabel}
            variant={danger ? 'danger' : 'dark'}
            loading={loading}
            onPress={onConfirm}
          />
          <SecondaryButton
            label={cancelLabel}
            disabled={loading}
            onPress={onCancel}
          />
        </>
      }>
      <View style={styles.head}>
        {icon ? (
          <View
            style={[
              styles.tile,
              {backgroundColor: danger ? colors.dangerSoft : colors.limeSoft},
            ]}>
            <Icon
              name={icon}
              size={22}
              color={danger ? colors.danger : colors.limeDark}
            />
          </View>
        ) : null}
        <Text style={styles.body}>{body}</Text>
      </View>
      {children}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start'},
  tile: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {...type.body, color: colors.inkSoft, flex: 1, lineHeight: 20},
});
