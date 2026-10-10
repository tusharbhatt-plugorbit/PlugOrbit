/**
 * Presenter tools (demo switches, jump-to-any-screen, reset demo data) are for
 * developers and demos, not customers. They show in debug builds only.
 *
 * For a showcase build that must keep them, set FORCE_PRESENTER_TOOLS to true
 * before building. It is deliberately a source constant, not an environment
 * variable, so a release made for customers cannot have it switched on by accident.
 */
export const FORCE_PRESENTER_TOOLS = false;

/** Read at call time, so it follows __DEV__ (and so tests can flip it). */
export function presenterToolsEnabled(): boolean {
  return __DEV__ || FORCE_PRESENTER_TOOLS;
}
