const { withDangerousMod } = require("@expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");
const fs = require("fs");
const path = require("path");

const SNIPPET = `    # @generated begin fmt-xcode26-fix
    # Xcode 26: fmt 11 consteval breaks Apple Clang — compile fmt as C++17.
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |bc|
          bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        end
      end
    end
    # @generated end fmt-xcode26-fix`;

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
      if (contents.includes("fmt-xcode26-fix")) {
        return config;
      }

      const merged = mergeContents({
        tag: "fmt-xcode26-fix",
        src: contents,
        newSrc: SNIPPET,
        anchor:
          /:ccache_enabled => ccache_enabled\?\(podfile_properties\),\n\s*\)/,
        offset: 1,
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
