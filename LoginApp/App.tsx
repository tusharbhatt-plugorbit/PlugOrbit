import React, {useState} from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

function App(): React.JSX.Element {
  // Navigation State: 'welcome' | 'login' | 'signup'
  const [screen, setScreen] = useState<'welcome' | 'login' | 'signup'>('welcome');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Theme Colors matching the exact PlugOrbit design
  const theme = {
    bg: '#0A111E',
    cardBg: '#111C2E',
    accentLime: '#9FE870',
    textWhite: '#FFFFFF',
    textMuted: '#94A3B8',
    inputBg: '#1A273A',
    inputBorder: '#293A52',
    buttonBorder: '#26354A',
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

  // --- WELCOME / LANDING SCREEN (MATCHING DESIGN) ---
  if (screen === 'welcome') {
    return (
      <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

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

          {/* EV Hero Illustration */}
          <View style={styles.illustrationCard}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1563720223185-11003d516935?q=80&w=1000&auto=format&fit=crop',
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
                pressed && {backgroundColor: '#172438'},
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
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />

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
              placeholderTextColor={theme.textMuted}
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
                placeholderTextColor={theme.textMuted}
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
    backgroundColor: '#0A111E',
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
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: '#9FE870',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },

  logoIcon: {
    fontSize: 24,
  },

  brandTitle: {
    fontSize: 22,
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
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 6,
  },

  illustrationCard: {
    flex: 1,
    maxHeight: 320,
    marginVertical: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111C2E',
    borderWidth: 1,
    borderColor: '#1E2D42',
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
    backgroundColor: '#334155',
    marginHorizontal: 4,
  },

  activeDot: {
    width: 22,
    backgroundColor: '#9FE870',
  },

  buttonGroup: {
    gap: 12,
  },

  primaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#9FE870',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryBtnText: {
    color: '#0A111E',
    fontSize: 16,
    fontWeight: '700',
  },

  secondaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: '#111C2E',
    borderWidth: 1,
    borderColor: '#26354A',
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
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
    color: '#9FE870',
    fontSize: 15,
    fontWeight: '600',
  },

  authCard: {
    backgroundColor: '#111C2E',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1E2D42',
  },

  logoBadgeSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#9FE870',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },

  logoIconSmall: {
    fontSize: 20,
  },

  authTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  authSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
  },

  inputGroup: {
    marginBottom: 16,
  },

  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 8,
  },

  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#293A52',
    backgroundColor: '#1A273A',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#FFFFFF',
  },

  passwordContainer: {
    height: 50,
    borderWidth: 1,
    borderColor: '#293A52',
    backgroundColor: '#1A273A',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#FFFFFF',
  },

  showButton: {
    paddingHorizontal: 14,
  },

  showText: {
    color: '#9FE870',
    fontWeight: '600',
    fontSize: 14,
  },

  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 20,
  },

  forgotText: {
    color: '#9FE870',
    fontSize: 14,
    fontWeight: '600',
  },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },

  switchText: {
    color: '#94A3B8',
    fontSize: 14,
  },

  switchLink: {
    color: '#9FE870',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default App;