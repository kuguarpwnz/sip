#!/usr/bin/env bash
# Cold-start timing for an installed Android app.
# TotalTime is the first frame (am start -W). Fully drawn is the app's own reportFullyDrawn(), read from logcat.
# Usage: measure-startup.sh <package> [runs=15]
set -uo pipefail

pkg=${1:?usage: measure-startup.sh <package> [runs=15]}
runs=${2:-15}

if ! adb devices | awk 'NR>1 && $2=="device"' | grep -q .; then
	echo "error: no adb device attached (check the cable and USB debugging authorization)" >&2
	exit 1
fi
if [ "$(adb devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')" -gt 1 ] && [ -z "${ANDROID_SERIAL:-}" ]; then
	echo "error: more than one device attached, set ANDROID_SERIAL" >&2
	exit 1
fi

shell() { adb shell "$@" | tr -d '\r'; }

component=$(shell cmd package resolve-activity --brief "$pkg" | tail -1)
case "$component" in
	*/*) ;;
	*) echo "error: could not resolve a launcher activity for $pkg (got: '$component')" >&2; exit 1 ;;
esac

model=$(shell getprop ro.product.model)
release=$(shell getprop ro.build.version.release)
echo "device:    $model, Android $release"
echo "component: $component"
echo "runs:      $runs (plus one warm-up)"

adb shell input keyevent KEYCODE_WAKEUP >/dev/null
if ! shell dumpsys power | grep -q 'mWakefulness=Awake'; then
	echo "error: screen is not awake" >&2
	exit 1
fi

# "+1s23ms", "+523ms", "+1m2s3ms" to milliseconds
fully_drawn_ms() {
	shell logcat -d |
		grep "Fully drawn .*${pkg}/" | tail -1 |
		sed -n 's/.*: +\([0-9a-z]*\).*/\1/p' |
		awk '{
			s = $0; ms = 0
			if (match(s, /[0-9]+h/)) { ms += substr(s, RSTART, RLENGTH - 1) * 3600000 }
			if (match(s, /[0-9]+m[^s]/)) { ms += substr(s, RSTART, RLENGTH - 2) * 60000 }
			if (match(s, /[0-9]+s/)) { ms += substr(s, RSTART, RLENGTH - 1) * 1000 }
			if (match(s, /[0-9]+ms/)) { ms += substr(s, RSTART, RLENGTH - 2) }
			print ms
		}'
}

# Prints "<total_ms> <fully_drawn_ms>" or fails with a reason on stderr.
cold_start() {
	adb shell am force-stop "$pkg"
	sleep 2
	adb logcat -c
	local out total fd i
	out=$(shell am start -W -n "$component")
	total=$(printf '%s\n' "$out" | sed -n 's/^TotalTime: *\([0-9]*\).*/\1/p')
	if [ -z "$total" ]; then
		echo "no TotalTime in am start output: $(printf '%s' "$out" | tr '\n' ' ')" >&2
		return 1
	fi
	for i in $(seq 1 20); do
		fd=$(fully_drawn_ms)
		[ -n "$fd" ] && break
		sleep 0.25
	done
	if [ -z "$fd" ]; then
		echo "no 'Fully drawn' line within 5 s (TotalTime was $total ms)" >&2
		return 1
	fi
	echo "$total $fd"
}

echo
echo "warm-up (excluded from stats):"
if warm=$(cold_start); then
	echo "  total ${warm% *} ms, fully drawn ${warm#* } ms"
else
	echo "  failed, see message above"
fi

echo
printf '%4s  %12s  %14s\n' run total_ms fully_drawn_ms
results=$(mktemp)
errors=0
for n in $(seq 1 "$runs"); do
	if r=$(cold_start); then
		printf '%4s  %12s  %14s\n' "$n" "${r% *}" "${r#* }"
		echo "$r" >>"$results"
	else
		printf '%4s  %12s  %14s\n' "$n" ERROR ERROR
		errors=$((errors + 1))
	fi
done

stats() {
	sort -n | awk '{ v[NR] = $1 }
		END {
			if (NR == 0) { print "n/a"; exit }
			med = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2
			p = int(0.9 * NR); if (p < 0.9 * NR) p++
			printf "%6d  %6g  %6d  %6d\n", v[1], med, v[p], v[NR]
		}'
}
ok=$(wc -l <"$results" | tr -d ' ')
echo
echo "$ok of $runs runs ok, $errors errors"
printf '%-28s  %6s  %6s  %6s  %6s\n' "(ms, p90 is nearest rank)" min median p90 max
printf '%-28s  ' "TotalTime (first frame)"; awk '{print $1}' "$results" | stats
printf '%-28s  ' "Fully drawn (real content)"; awk '{print $2}' "$results" | stats
rm -f "$results"
[ "$errors" -eq 0 ]
