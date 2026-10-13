# PlugOrbit Android maps setup

The supplied Android Maps key is saved in LoginApp/.env.
Cloud billing/API enablement and device rendering still need verification.

Project: plugorbit-783dc
Package: com.loginapp
Debug signing SHA-1: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25

Enable billing and Maps SDK for Android on this project. Create a separate Android
Maps key restricted to that SDK and the package/SHA-1 above. Put it in
GOOGLE_MAPS_ANDROID_KEY in LoginApp/.env. Rebuild Android after changing the key.

For actual nearby station search, enable Places API (New). The supplied GOOGLE_PLACES_API_KEY is saved in LoginApp/.env. The current client calls the Places REST API directly, so its key
must allow Places API (New) and the installed Android package/SHA-1.
Requests send X-Android-Package and X-Android-Cert using the actual installed APK's
identity. Rebuild/reinstall Android after adding the native identity module. For production, move Places requests behind the authenticated backend
so its server key can use IP restrictions.

Restart Metro with --reset-cache after changing JavaScript environment values.
Grant location permission on the device. Missing Android Maps credentials activate
an OpenStreetMap fallback; it does not supply live station data.

References:
https://developers.google.com/maps/documentation/android-sdk/get-api-key
https://developers.google.com/maps/api-security-best-practices

## Windows build

Android Studio's bundled Java can be selected for the current terminal:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
cd LoginApp\android
.\gradlew.bat assembleDebug
```

The native staging directory is .native at the repository root. CMake object
paths are limited to 240 characters to avoid Ninja's Windows path-length error.
The staging directory is ignored by Git.
