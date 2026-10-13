const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '../node_modules/@react-native-community/geolocation/android/src/main/java/com/reactnativecommunity/geolocation/PlayServicesLocationManager.java');
if (!fs.existsSync(target)) throw new Error('Geolocation Android source is missing');
const source = fs.readFileSync(target, 'utf8');
const old = 'mFusedLocationClient.removeLocationUpdates(mSingleLocationCallback);\n                mSingleLocationCallback = null;';
const fixed = 'mFusedLocationClient.removeLocationUpdates(this);\n                if (mSingleLocationCallback == this) {\n                    mSingleLocationCallback = null;\n                }';
if (source.includes(fixed)) { console.log('GPS callback patch already applied'); }
else if (source.includes(old)) { fs.writeFileSync(target, source.replace(old, fixed)); console.log('Applied GPS null-listener/race fix'); }
else throw new Error('Geolocation source changed; review callback patch before building');
