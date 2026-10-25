const { withFinalizedMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Android masks a 108dp adaptive layer down to roughly 72dp. Keep the
// existing square artwork inside the central safe area without changing
// the shared iOS icon or resampling the logo in the source assets.
// Asymmetric horizontal insets shift it right by 2% without changing its size.
module.exports = function withAndroidIconInsets(config) {
  // Run after Expo generates resources; skip filesystem work during introspection.
  return withFinalizedMod(config, ['android', async config => {
    const res = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
    const drawableDir = path.join(res, 'drawable');
    await fs.mkdir(drawableDir, { recursive: true });
    await fs.writeFile(path.join(drawableDir, 'syntopico_launcher_foreground.xml'),
      `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:insetLeft="18%"
    android:insetRight="14%"
    android:insetTop="16%"
    android:insetBottom="16%"
    android:drawable="@mipmap/ic_launcher_foreground" />
`);

    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const file = path.join(res, 'mipmap-anydpi-v26', name);
      const xml = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, xml.replace(
        '<foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
        '<foreground android:drawable="@drawable/syntopico_launcher_foreground"/>',
      ));
    }
    return config;
  }]);
};
