#!/usr/bin/env bash
# Start (or reuse) the sip_pixel_6a emulator and make it ready for device checks.
# Prints the serial on stdout, progress on stderr: export ANDROID_SERIAL=$(scripts/emulator.sh)
# Usage: emulator.sh [--window] [--stop]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/env.sh"

avd=sip_pixel_6a
image="system-images;android-36;google_apis;arm64-v8a"
log="${TMPDIR:-/tmp}/sip-emulator.log"
window=0
stop=0

for arg in "$@"; do
	case "$arg" in
		--window) window=1 ;;
		--stop) stop=1 ;;
		*) echo "usage: emulator.sh [--window] [--stop]" >&2; exit 2 ;;
	esac
done

say() { echo "$*" >&2; }

# Serial of an attached emulator running $avd, or nothing.
find_running() {
	local s name
	for s in $(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1}'); do
		name=$(adb -s "$s" emu avd name 2>/dev/null | head -1 | tr -d '\r') || continue
		if [ "$name" = "$avd" ]; then
			echo "$s"
			return
		fi
	done
}

if [ "$stop" -eq 1 ]; then
	serial=$(find_running)
	if [ -z "$serial" ]; then
		say "$avd is not running"
		exit 0
	fi
	say "stopping $serial"
	adb -s "$serial" emu kill >/dev/null 2>&1 || true
	for _ in $(seq 1 60); do
		adb devices | awk '{print $1}' | grep -qx "$serial" || { say "stopped"; exit 0; }
		sleep 1
	done
	say "error: $serial still listed after 60 s"
	exit 1
fi

serial=$(find_running)
if [ -n "$serial" ]; then
	say "reusing $serial"
else
	if ! avdmanager list avd -c | grep -qx "$avd"; then
		if [ ! -d "$ANDROID_HOME/system-images/android-36/google_apis/arm64-v8a" ]; then
			say "error: system image missing, run: sdkmanager \"$image\""
			exit 1
		fi
		say "creating AVD $avd"
		echo no | avdmanager create avd -n "$avd" -k "$image" -d pixel_6a >&2
	fi

	flags=(-no-audio -no-boot-anim -no-snapshot-save)
	[ "$window" -eq 1 ] || flags+=(-no-window)
	say "starting $avd, log: $log"
	adb start-server >/dev/null 2>&1
	nohup emulator -avd "$avd" "${flags[@]}" >"$log" 2>&1 &

	for _ in $(seq 1 180); do
		serial=$(find_running)
		[ -n "$serial" ] && break
		sleep 1
	done
	if [ -z "$serial" ]; then
		say "error: emulator did not attach within 180 s, see $log"
		exit 1
	fi
fi

say "waiting for boot"
booted=0
for _ in $(seq 1 180); do
	if [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
		booted=1
		break
	fi
	sleep 1
done
if [ "$booted" -ne 1 ]; then
	say "error: $serial did not finish booting within 180 s, see $log"
	exit 1
fi

sh() { adb -s "$serial" shell "$@" >/dev/null; }
sh input keyevent KEYCODE_WAKEUP
sh wm dismiss-keyguard
sh settings put system screen_off_timeout 1800000
sh settings put global window_animation_scale 0
sh settings put global transition_animation_scale 0
sh settings put global animator_duration_scale 0

say "ready"
echo "$serial"
