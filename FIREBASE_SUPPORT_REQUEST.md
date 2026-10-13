# Firebase Google sign-in: conflicting Android OAuth registration

Subject: Cannot register Android OAuth client ? package/SHA conflict with unidentified project

Hello Firebase Support,

We are configuring Google sign-in for PlugOrbit and need help identifying the project containing a conflicting Android OAuth client.

Target Firebase project ID: plugorbit-783dc
Target project number: 212387544491
Android Firebase app ID: 1:212387544491:android:dd685905bb9d1f727de6ee
Android package name: com.loginapp
SHA-1 certificate fingerprint: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25

Google sign-in is enabled in the target Firebase project, and the app's Web client ID matches the provider configuration. The Android configuration has no Android OAuth client (client_type 1).

Registering the SHA through Firebase Management API returns HTTP 409:
Oauth client already exists in a different project for package name com.loginapp and certificate hash 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25.

We checked the Google Cloud Credentials pages visible in our accounts. No matching Android OAuth client was found. We also located an older Firebase project, plugorbit-279a8, whose previous Android app used the different package com.plugorbit.driver. Its Credentials page currently shows no OAuth clients. We have not confirmed that the older project contains the conflict.

Please help identify the conflicting registration and explain how its owner can release it, or how we can resolve it while preserving com.loginapp and the existing APK signing certificate. We do not authorize deleting either Firebase project or unrelated credentials.

Thank you,
PlugOrbit
Contact: admin@plugorbit.com
