#!/usr/bin/env bash
# Release build signed with signing/sip-release.keystore, verified, copied to sip.apk at the repo root.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/env.sh"
cd "$root"

if [ ! -f signing/keystore.properties ]; then
	echo "error: signing/keystore.properties is missing. Without the original keystore an installed Sip cannot be updated." >&2
	exit 1
fi

pnpm tauri android build --apk --target aarch64
built=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
if [ ! -f "$built" ]; then
	echo "error: expected a signed APK at $built" >&2
	exit 1
fi

apksigner verify --verbose --print-certs "$built"
zipalign -c -P 16 4 "$built" && echo "zipalign ok"
cp "$built" sip.apk
ls -l sip.apk
