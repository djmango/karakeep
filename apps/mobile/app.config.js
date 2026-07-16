const IS_DEV = process.env.APP_VARIANT === "development";

const IOS_APP_GROUP = IS_DEV
  ? "group.gg.skg.karakeep.dev"
  : "group.gg.skg.karakeep";

export default {
  expo: {
    ...(IS_DEV
      ? {
          name: "Karakeep (Dev)",
          scheme: "karakeep-dev",
        }
      : {
          name: "Karakeep",
          scheme: "karakeep",
        }),
    slug: "karakeep-skg",
    version: "1.9.5",
    orientation: "portrait",
    icon: "./assets/icon.png",
    experiments: {
      reactCanary: true,
    },
    userInterfaceStyle: "automatic",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      appleTeamId: "A95F4H2423",
      bundleIdentifier: IS_DEV ? "karakeep.skg.gg" : "gg.skg.karakeep",
      splash: {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          image: "./assets/splash-white.png",
          resizeMode: "contain",
          backgroundColor: "#000000",
        },
      },
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
      },
      buildNumber: "43",
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000",
        monochromeImage: "./assets/adaptive-icon.png",
      },
      splash: {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          image: "./assets/splash-white.png",
          resizeMode: "contain",
          backgroundColor: "#000000",
        },
      },
      package: IS_DEV ? "karakeep.skg.gg" : "gg.skg.karakeep",
      versionCode: 43,
    },
    plugins: [
      "./plugins/trust-local-certs.js",
      "./plugins/camera-not-required.js",
      "expo-router",
      [
        "expo-share-intent",
        {
          iosAppGroupIdentifier: IOS_APP_GROUP,
          iosShareExtensionBundleIdentifier: IS_DEV
            ? "karakeep.skg.gg.share-extension"
            : "gg.skg.karakeep.share-extension",
          iosActivationRules: {
            NSExtensionActivationSupportsWebURLWithMaxCount: 1,
            NSExtensionActivationSupportsWebPageWithMaxCount: 1,
            NSExtensionActivationSupportsImageWithMaxCount: 1,
            NSExtensionActivationSupportsMovieWithMaxCount: 0,
            NSExtensionActivationSupportsText: true,
            NSExtensionActivationSupportsFileWithMaxCount: 10,
            NSExtensionActivationRule:
              'SUBQUERY (extensionItems, $extensionItem, SUBQUERY ($extensionItem.attachments, $attachment, SUBQUERY ($attachment.registeredTypeIdentifiers, $uti, $uti UTI-CONFORMS-TO "com.adobe.pdf" || $uti UTI-CONFORMS-TO "public.image" || $uti UTI-CONFORMS-TO "public.url" || $uti UTI-CONFORMS-TO "public.plain-text").@count >= 1).@count >= 1).@count >= 1',
          },
          androidIntentFilters: ["text/*", "image/*", "application/pdf"],
        },
      ],
      "expo-secure-store",
      [
        "expo-image-picker",
        {
          photosPermission:
            "The app access your photo gallary on your request to hoard them.",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: true,
            targetSdkVersion: 35,
            ndkVersion: "27.1.12297006",
          },
        },
      ],
      "expo-web-browser",
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: "react-native",
          organization: "localhost-labs-ltd",
        },
      ],
    ],
    extra: {
      router: {
        origin: false,
      },
      eas: {
        projectId: "b5555997-af97-4a6a-b507-4d5db492cb87",
      },
    },
  },
};
