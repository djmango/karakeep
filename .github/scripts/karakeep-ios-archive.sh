#!/usr/bin/env bash
# Archive Karakeep and send it to TestFlight.
#
# Signing / App Store Connect material is secrets/ci/apple.yaml (sops),
# decrypted into the environment by .github/scripts/decrypt-apple-ci.sh and
# imported by the .github/actions/install-ios-signing action. No secret value is
# ever printed: this repository is public, so the build log is public too.
#
#   .github/scripts/karakeep-ios-archive.sh                     # export + upload
#   KARAKEEP_TESTFLIGHT_UPLOAD=false .github/scripts/karakeep-ios-archive.sh
#
# Karakeep is an Expo app, so the iOS project is not in the repo: prebuild
# generates it here, then xcodebuild archives it with automatic signing against
# the App Store Connect API key. The app carries a share extension
# (gg.skg.karakeep.share-extension), so the archive needs profiles for both
# bundle ids; -allowProvisioningUpdates fetches or creates them.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mobile_dir="$repo_root/apps/mobile"
ios_dir="$mobile_dir/ios"
build_dir="$mobile_dir/build"
archive_path="$build_dir/Karakeep.xcarchive"
export_dir="$build_dir/export"
upload="${KARAKEEP_TESTFLIGHT_UPLOAD:-true}"

# TestFlight rejects a build number it has already seen, and a re-run reuses the
# GitHub run number, so take a monotonic timestamp instead (yyMMddHHmm).
build_number="${KARAKEEP_IOS_BUILD_NUMBER:-$(date -u +%y%m%d%H%M)}"

if [[ -z "${APP_STORE_CONNECT_API_KEY_PATH:-}" || -z "${APP_STORE_CONNECT_API_KEY_ID:-}" ]]; then
  echo "::error::App Store Connect API key is not in the environment. Run .github/scripts/decrypt-apple-ci.sh first."
  exit 1
fi

auth_args=(
  -authenticationKeyPath "$APP_STORE_CONNECT_API_KEY_PATH"
  -authenticationKeyID "$APP_STORE_CONNECT_API_KEY_ID"
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_API_ISSUER_ID"
)

# xcodebuild shells out to rsync while exporting; Homebrew's rsync breaks that
# ("Copy failed" / --extended-attributes), so the system one goes first.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

echo "→ Installing the workspace…"
corepack enable
(cd "$repo_root" && corepack pnpm install --frozen-lockfile)

echo "→ Generating the iOS project (expo prebuild)…"
(cd "$mobile_dir" && APP_VARIANT=production npx expo prebuild --platform ios --clean)

if [[ ! -d "$ios_dir/Karakeep.xcodeproj" ]]; then
  echo "::error::prebuild did not produce $ios_dir/Karakeep.xcodeproj"
  exit 1
fi

# Braces are load-bearing: the runner's bash treats high bytes as valid
# identifier characters, so `$build_number…` parses as a variable named
# "build_number…" and dies with `unbound variable` under `set -u`.
echo "→ Setting the build number to ${build_number}…"
# The app's Info.plist pins CFBundleVersion literally; the extension reads the
# build setting, so both have to move together.
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$ios_dir/Karakeep/Info.plist"
perl -pi -e "s/CURRENT_PROJECT_VERSION = \"?[0-9.]+\"?;/CURRENT_PROJECT_VERSION = $build_number;/g" \
  "$ios_dir/Karakeep.xcodeproj/project.pbxproj"
grep -c "CURRENT_PROJECT_VERSION = $build_number;" "$ios_dir/Karakeep.xcodeproj/project.pbxproj"

echo "→ Archiving (Release)…"
xcodebuild \
  -workspace "$ios_dir/Karakeep.xcworkspace" \
  -scheme Karakeep \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$archive_path" \
  -allowProvisioningUpdates \
  "${auth_args[@]}" \
  archive

options_plist="$build_dir/ExportOptions.plist"
mkdir -p "$build_dir"
if [[ "$upload" == "true" ]]; then
  destination="upload"
else
  destination="export"
fi
cat > "$options_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>$destination</string>
	<key>uploadSymbols</key>
	<true/>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>A95F4H2423</string>
</dict>
</plist>
PLIST

if [[ "$upload" == "true" ]]; then
  echo "→ Exporting and uploading to App Store Connect…"
else
  echo "→ Exporting the signed IPA…"
fi
xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_dir" \
  -exportOptionsPlist "$options_plist" \
  -allowProvisioningUpdates \
  "${auth_args[@]}"

find "$export_dir" -name "*.ipa" -maxdepth 1 | sed 's/^/   IPA: /'
echo "Done. TestFlight processes the build over the next few minutes."
