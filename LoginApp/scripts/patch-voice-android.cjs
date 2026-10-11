/* These legacy speech libraries predate our Android Gradle Plugin. Keep their
 * native sources and JS APIs, but use the app's SDK/plugin and AndroidX.
 * Version checks intentionally fail on upgrades: review compatibility first.
 */
const fs = require('node:fs');
const path = require('node:path');

const modules = [
  ['@react-native-voice/voice', '3.2.4', 'com.wenkesj.voice'],
  ['react-native-tts', '4.1.1', 'net.no_mad.tts'],
];

for (const [name, version, namespace] of modules) {
  const root = path.dirname(require.resolve(`${name}/package.json`));
  const installed = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  if (installed.version !== version) {
    throw new Error(
      `Review Android compatibility for ${name}@${installed.version}; expected ${version}.`,
    );
  }
  const gradle = `apply plugin: 'com.android.library'
android {
    namespace '${namespace}'
    compileSdkVersion rootProject.ext.compileSdkVersion
    defaultConfig {
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
    }
}
repositories { google(); mavenCentral() }
dependencies {
    implementation 'com.facebook.react:react-android'
    implementation 'androidx.appcompat:appcompat:1.7.1'
}
`;
  fs.writeFileSync(path.join(root, 'android', 'build.gradle'), gradle);
  const manifestPath = path.join(
    root,
    'android',
    'src',
    'main',
    'AndroidManifest.xml',
  );
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(manifestPath, manifest.replace(/\s+package="[^"]*"/, ''));
  process.stdout.write(`Android compatibility applied: ${name}@${version}\n`);
}
