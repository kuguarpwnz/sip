#!/usr/bin/env bash
# Release build, zipalign, sign with a throwaway local keystore, verify.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../../env.sh"
cd "$here"

ks=sip-sketch.keystore
pass=sketch-throwaway
if [ ! -f "$ks" ]; then
	keytool -genkeypair -keystore "$ks" -storepass "$pass" -keypass "$pass" -alias sketch \
		-keyalg RSA -keysize 2048 -validity 3650 -dname "CN=Sip sketch" >/dev/null
fi

pnpm tauri android build --apk --target aarch64
unsigned=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
aligned=sip-tauri-aligned.apk
signed=sip-tauri.apk
rm -f "$aligned" "$signed" "$signed.idsig"
zipalign -P 16 -f 4 "$unsigned" "$aligned"
apksigner sign --ks "$ks" --ks-pass "pass:$pass" --key-pass "pass:$pass" --out "$signed" "$aligned"
rm -f "$aligned"
apksigner verify --verbose "$signed"
zipalign -c -P 16 4 "$signed" && echo "zipalign ok"
ls -l "$signed"
