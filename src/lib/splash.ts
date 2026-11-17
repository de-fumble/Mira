/**
 * iPhone and iPad screens (portrait CSS size × pixel ratio). iOS shows a
 * launch image only when one matches the device exactly, so each needs its own
 * file in public/splash. Those PNGs are screenshots of the in-app splash
 * (components/Splash.tsx) at each size — retake them if the splash changes.
 */
export const SPLASH_SCREENS: [width: number, height: number, ratio: number][] = [
  // iPhones
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [420, 912, 3], // Air
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [414, 736, 3], // 6 Plus – 8 Plus
  [375, 667, 2], // 6 – 8, SE (2nd and 3rd gen)
  [320, 568, 2], // SE (1st gen)
  // iPads
  [1032, 1376, 2], // Pro 13" (M4)
  [1024, 1366, 2], // Pro 12.9"
  [834, 1210, 2], // Pro 11" (M4)
  [834, 1194, 2], // Pro 11"
  [820, 1180, 2], // Air, 10th gen
  [834, 1112, 2], // Air 3rd gen, Pro 10.5"
  [810, 1080, 2], // 9th gen
  [768, 1024, 2], // mini 5th gen, older iPads
  [744, 1133, 2], // mini 6th gen
];

export const splashFile = ([w, h, r]: [number, number, number]) => `/splash/${w * r}x${h * r}.png`;

/** <link rel="apple-touch-startup-image"> entries for the root metadata. */
export const appleStartupImages = SPLASH_SCREENS.map((s) => ({
  url: splashFile(s),
  media: `(device-width: ${s[0]}px) and (device-height: ${s[1]}px) and (-webkit-device-pixel-ratio: ${s[2]}) and (orientation: portrait)`,
}));
