import {getStorage} from './storage';

// Whether the first-run introduction has been seen. Kept in its own key, outside
// the app store, so it never joins the cloud backup or the store's schema: it is a
// property of this install, not of the account.
const KEY = 'plugorbit/onboarding-seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await getStorage().getItem(KEY)) === '1';
  } catch {
    // Unreadable storage must never trap anyone in the introduction.
    return true;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await getStorage().setItem(KEY, '1');
  } catch {
    // Best effort: worst case the introduction shows once more.
  }
}
