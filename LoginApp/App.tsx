import React, {useState} from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  // Navigation State: 'welcome' | 'login' | 'signup'
  const [screen, setScreen] = useState<'welcome' | 'login' | 'signup'>('welcome');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // High-Contrast Theme Palette (WCAG AAA Compliant)
  const theme = {
    bg: '#060A12',           // Deep Obsidian Dark Background
    cardBg: '#111827',       // High Contrast Card Container
    accentLime: '#A2F067',   // Electric Lime Green Accent
    textWhite: '#FFFFFF',    // Pure White Primary Text
    textMuted: '#CBD5E1',    // Slate 200 High Contrast Subtext
    textPlaceholder: '#9CA3AF',
    inputBg: '#1F2937',      // Distinct Dark Input Field Background
    inputBorder: '#374151',  // Sharp High Contrast Borders
    secondaryBtnBg: '#111827',
    secondaryBtnBorder: '#374151',
  };

  const handleLogin = () => {
    if (!email.trim()) {
      Alert.alert('Validation', 'Please enter your email.');
      return;
    }

    if (!password.trim()) {
      Alert.alert('Validation', 'Please enter your password.');
      return;
    }

    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      Alert.alert('Success', `Welcome back, ${email}!`);
    }, 1000);
  };

  // --- WELCOME / LANDING SCREEN ---
  if (screen === 'welcome') {
    return (
      <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
        <StatusBar barStyle="light-content" />

        <View style={styles.welcomeContainer}>
          {/* Header & Logo Section */}
          <View style={styles.headerSection}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoIcon}>⚡</Text>
            </View>
            <Text style={styles.brandTitle}>PlugOrbit</Text>
            <Text style={styles.mainHeading}>Welcome to PlugOrbit</Text>
            <Text style={styles.tagline}>Charge Smarter. Travel Further.</Text>
          </View>

          {/* Clean EV Hero Image (without brand text / names) */}
          <View style={styles.illustrationCard}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?q=80&w=1000&auto=format&fit=crop',
              }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          </View>

          {/* Carousel Pagination Dots */}
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.activeDot]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonGroup}>
            <Pressable
              style={({pressed}) => [
                styles.primaryBtn,
                pressed && {opacity: 0.88},
              ]}
              onPress={() => setScreen('signup')}>
              <Text style={styles.primaryBtnText}>Get Started</Text>
            </Pressable>

            <Pressable
              style={({pressed}) => [
                styles.secondaryBtn,
                pressed && {backgroundColor: '#1E293B'},
              ]}
              onPress={() => setScreen('login')}>
              <Text style={styles.secondaryBtnText}>
                I already have an account
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // --- LOGIN / SIGNUP SCREEN ---
  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        {/* Back Button */}
        <Pressable
          style={styles.backButton}
          onPress={() => setScreen('welcome')}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>

        <View style={styles.authCard}>
          <View style={styles.logoBadgeSmall}>
            <Text style={styles.logoIconSmall}>⚡</Text>
          </View>

          <Text style={styles.authTitle}>
            {screen === 'login' ? 'Sign In' : 'Create Account'}
          </Text>

          <Text style={styles.authSubtitle}>
            {screen === 'login'
              ? 'Enter your details to access your PlugOrbit account.'
              : 'Join PlugOrbit to start charging smarter everywhere.'}
          </Text>

          {/* Email Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="name@example.com"
              placeholderTextColor={theme.textPlaceholder}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter password"
                placeholderTextColor={theme.textPlaceholder}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <Pressable
                style={styles.showButton}
                onPress={() => setShowPassword(!showPassword)}>
                <Text style={styles.showText}>
                  {showPassword ? 'Hide' : 'Show'}
                </Text>
              </Pressable>
            </View>
          </View>

          {screen === 'login' && (
            <Pressable
              style={styles.forgotButton}
              onPress={() =>
                Alert.alert('Forgot Password', 'Password reset instructions sent.')
              }>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          )}

          {/* Submit Button */}
          <Pressable
            style={({pressed}) => [
              styles.primaryBtn,
              pressed && {opacity: 0.88},
            ]}
            onPress={
              screen === 'login'
                ? handleLogin
                : () => {
                    Alert.alert('Account Created', 'Your account is ready!');
                    setScreen('login');
                  }
            }
            disabled={loading}>
            <Text style={styles.primaryBtnText}>
              {loading
                ? 'Processing...'
                : screen === 'login'
                ? 'Sign In'
                : 'Create Account'}
            </Text>
          </Pressable>

          {/* Switch Login/Signup */}
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>
              {screen === 'login'
                ? "Don't have an account?"
                : 'Already have an account?'}
            </Text>
            <Pressable
              onPress={() =>
                setScreen(screen === 'login' ? 'signup' : 'login')
              }>
              <Text style={styles.switchLink}>
                {screen === 'login' ? ' Sign Up' : ' Sign In'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#060A12',
  },

  welcomeContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 20 : 10,
    paddingBottom: 24,
  },

  headerSection: {
    alignItems: 'center',
    marginTop: 10,
  },

  logoBadge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: '#A2F067',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    backgroundColor: '#0F1A2A',
  },

  logoIcon: {
    fontSize: 26,
  },

  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 16,
  },

  mainHeading: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  tagline: {
    fontSize: 15,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: 6,
    fontWeight: '500',
  },

  illustrationCard: {
    flex: 1,
    maxHeight: 320,
    marginVertical: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1.5,
    borderColor: '#374151',
  },

  heroImage: {
    width: '100%',
    height: '100%',
  },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#475569',
    marginHorizontal: 4,
  },

  activeDot: {
    width: 24,
    backgroundColor: '#A2F067',
  },

  buttonGroup: {
    gap: 12,
  },

  primaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#A2F067',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '800',
  },

  secondaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1.5,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Auth Screen Styles
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },

  backButton: {
    marginBottom: 16,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },

  backButtonText: {
    color: '#A2F067',
    fontSize: 16,
    fontWeight: '700',
  },

  authCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#374151',
  },

  logoBadgeSmall: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: '#A2F067',
    backgroundColor: '#0F1A2A',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },

  logoIconSmall: {
    fontSize: 22,
  },

  authTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  authSubtitle: {
    fontSize: 14,
    color: '#CBD5E1',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
  },

  inputGroup: {
    marginBottom: 16,
  },

  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F3F4F6',
    marginBottom: 8,
  },

  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    paddingHorizontal: 15,
    fontSize: 15,
    color: '#FFFFFF',
  },

  passwordContainer: {
    height: 52,
    borderWidth: 1.5,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 15,
    fontSize: 15,
    color: '#FFFFFF',
  },

  showButton: {
    paddingHorizontal: 14,
  },

  showText: {
    color: '#A2F067',
    fontWeight: '700',
    fontSize: 14,
  },

  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },

  forgotText: {
    color: '#A2F067',
    fontSize: 14,
    fontWeight: '700',
  },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },

  switchText: {
    color: '#CBD5E1',
    fontSize: 14,
  },

  switchLink: {
    color: '#A2F067',
    fontSize: 14,
    fontWeight: '800',
  },
});

export default App;