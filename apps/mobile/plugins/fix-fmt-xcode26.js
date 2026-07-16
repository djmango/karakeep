const { withDangerousMod } = require("@expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");
const fs = require("fs");
const path = require("path");

// Single-line snippet only — mergeContents matches anchors per-line.
const SNIPPET = `
    # Xcode 26: fmt 11 consteval breaks Apple Clang — compile fmt as C++17.
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |bc|
          bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        end
      end
    end
`;

/**
 * Inject a Podfile post_install fix so local + EAS builds succeed on Xcode 26.
 */
function withFmtXcode26Fix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile",
      );
      if (!fs.existsSync(podfilePath)) {
        return config;
      }
      const contents = fs.readFileSync(podfilePath, "utf8");
      if (
        contents.includes("fmt-xcode26-fix") ||
        contents.includes("CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'")
      ) {
        return config;
      }

      // Anchor must be a single line — generateCode matches line-by-line.
      const merged = mergeContents({
        tag: "fmt-xcode26-fix",
        src: contents,
        newSrc: SNIPPET.trimEnd(),
        anchor: /:ccache_enabled => ccache_enabled\?\(podfile_properties\),/,
        offset: 2,
        comment: "#",
      });

      if (merged.didMerge) {
        fs.writeFileSync(podfilePath, merged.contents);
      }
      return config;
    },
  ]);
}

module.exports = withFmtXcode26Fix;
