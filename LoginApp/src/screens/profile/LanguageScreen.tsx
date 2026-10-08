import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '../../navigation/NavigationContext';
import {appStore, useApp} from '../../store/appStore';
import {colors, spacing, type} from '../../theme';
import {Notice, PrimaryButton, Screen, showToast} from '../../ui';
import {ChoiceCard} from '../../ui/ChoiceCard';

type Lang = 'en' | 'hi';

/**
 * Language. English is the only translated language today. Hindi can be chosen
 * and is remembered (appStore.language), but the screens are not translated
 * yet, and the screen says so instead of pretending.
 */
export default function LanguageScreen(): React.JSX.Element {
  const nav = useNavigation();
  const language = useApp(s => s.language);

  const choose = (lang: Lang) => {
    if (lang === language) {
      return;
    }
    // A pure UI preference, so it is written straight to the store.
    appStore.set({language: lang});
    showToast(
      lang === 'hi'
        ? 'Hindi saved. PlugOrbit stays in English until it’s translated.'
        : 'English selected.',
      lang === 'hi' ? 'info' : 'success',
    );
  };

  return (
    <Screen
      title="Language"
      footer={<PrimaryButton label="Done" icon="check" onPress={nav.goBack} />}>
      <Text style={styles.lead}>Choose the language you’d like to use.</Text>

      <View style={styles.list}>
        <ChoiceCard
          icon="languages"
          title="English"
          body="Fully available across the app."
          selected={language === 'en'}
          onPress={() => choose('en')}
        />
        <ChoiceCard
          icon="globe"
          title="हिन्दी (Hindi)"
          body="Your choice is saved, but the app isn’t translated yet."
          selected={language === 'hi'}
          onPress={() => choose('hi')}
        />
      </View>

      {language === 'hi' && (
        <View style={styles.notice}>
          {/* TODO(i18n): ship Hindi strings and switch the UI when language === 'hi'. */}
          <Notice
            tone="info"
            title="Hindi isn’t translated yet"
            body="We’ve saved your choice. Until the translation is ready, PlugOrbit keeps showing English, and will switch automatically when Hindi ships."
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {...type.body, color: colors.muted},
  list: {gap: spacing.md, marginTop: spacing.lg},
  notice: {marginTop: spacing.lg},
});
