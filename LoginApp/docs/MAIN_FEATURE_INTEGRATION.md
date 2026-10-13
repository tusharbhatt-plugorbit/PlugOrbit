# Main feature integration

Imported advanced assistant, voice controls, driver dashboard, onboarding, and Guided/Orbit Assist preferences from origin/main. Main is unchanged.

Retained working Firebase authentication, Google station discovery, road routing, native QR scanner, receipt export, support and performance fixes instead of duplicate mock implementations.

Manual trip stations require compatible connectors, confirmed open hours and non-offline status. Missing connector/hours information is excluded. Operator data is needed to fill missing data accurately.

Assistant gateway: /orbit-assist. Gemini keys stay on the server; voice asks for microphone permission; mutating actions require confirmation. Google AI project access denial, SMS billing, deleted OAuth client and public HTTPS hosting remain external setup requirements.

Validation: TypeScript and 252 frontend regression tests, plus 76 backend provider/tool/auth tests passed before APK build.

Release build passed and installed successfully on ZA222LQGPT. Cold launch: 488 ms. Initial native/JS crash buffers were empty; map and assistant screens opened. Live backend account sync/status returned credential reauthentication errors; owner must refresh Google Application Default Credentials. Voice availability on the phone currently reports unavailable; typing remains available. Live trip completion and voice recognition are not certified by the smoke test.
