#!/usr/bin/env bash
# Usage: scripts/release.sh <patch|minor|major|X.Y.Z>
# Bumps the version, builds and verifies sip.apk, commits, tags, pushes, and publishes a GitHub release.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/env.sh"
cd "$root"

fail() {
	echo "error: $*" >&2
	exit 1
}

[ $# -eq 1 ] || fail "usage: scripts/release.sh <patch|minor|major|X.Y.Z>"
case "$1" in
patch | minor | major) ;;
*) [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$1' is not patch, minor, major or a version like 1.2.3" ;;
esac

branch="$(git symbolic-ref --short -q HEAD || true)"
[ "$branch" = main ] || fail "must be on branch main (on '${branch:-detached HEAD}')"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
gh auth status >/dev/null 2>&1 || fail "gh is not logged in, run: gh auth login"
git remote get-url origin >/dev/null 2>&1 || fail "git remote 'origin' is not set"
[ -f signing/keystore.properties ] || fail "signing/keystore.properties is missing. Without the original keystore an installed Sip cannot be updated."

current="$(node -p 'require("./src-tauri/tauri.conf.json").version')"
version="$(node -e '
const [bump, cur] = process.argv.slice(1)
const c = cur.split(".").map(Number)
let n
if (bump === "patch") n = [c[0], c[1], c[2] + 1]
else if (bump === "minor") n = [c[0], c[1] + 1, 0]
else if (bump === "major") n = [c[0] + 1, 0, 0]
else n = bump.split(".").map(Number)
const newer = n[0] - c[0] || n[1] - c[1] || n[2] - c[2]
if (!(newer > 0)) { console.error(`error: ${n.join(".")} is not greater than the current version ${cur}`); process.exit(1) }
console.log(n.join("."))
' "$1" "$current")"
tag="v$version"

git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "tag $tag already exists locally"
remote_tag="$(git ls-remote --tags origin "refs/tags/$tag")" || fail "could not reach origin to check for tag $tag"
[ -z "$remote_tag" ] || fail "tag $tag already exists on origin"

node - "$version" <<'EOF'
const fs = require("fs")
const version = process.argv[2]

for (const file of ["src-tauri/tauri.conf.json", "package.json"]) {
	const json = JSON.parse(fs.readFileSync(file, "utf8"))
	json.version = version
	fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n")
}

const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8").split("\n")
const start = cargo.indexOf("[package]")
let end = cargo.findIndex((line, i) => i > start && line.startsWith("["))
if (end < 0) end = cargo.length
const at = cargo.findIndex((line, i) => i > start && i < end && /^version\s*=/.test(line))
if (at < 0) throw new Error("no version in [package] of Cargo.toml")
cargo[at] = `version = "${version}"`
fs.writeFileSync("src-tauri/Cargo.toml", cargo.join("\n"))

// The build rewrites Cargo.lock for the new package version anyway, so commit it with the bump.
const lock = fs.readFileSync("src-tauri/Cargo.lock", "utf8")
const bumped = lock.replace(/(\[\[package\]\]\nname = "sip"\nversion = ")[^"]+(")/, `$1${version}$2`)
if (bumped === lock) throw new Error("no sip package in Cargo.lock")
fs.writeFileSync("src-tauri/Cargo.lock", bumped)
EOF
version_files=(src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml src-tauri/Cargo.lock)

stage="version files edited, nothing committed. Discard with: git checkout -- ${version_files[*]}"
resume=""
trap 'echo "error: release $tag stopped. State: $stage" >&2; [ -z "$resume" ] || echo "Resume with:$resume" >&2' EXIT

scripts/build-apk.sh
built="$(aapt2 dump badging sip.apk | sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p")"
[ "$built" = "$version" ] || fail "sip.apk has versionName '${built:-none}', expected $version"

asset_dir="$(mktemp -d)"
asset="$asset_dir/sip-$version.apk"
cp sip.apk "$asset"

git commit -q -m "Release $tag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- "${version_files[@]}"
stage="commit made, tag not created, nothing pushed."
resume="
	git tag -a $tag -m $tag && git push origin main $tag && gh release create $tag \"$asset\" --title $tag --generate-notes"
git tag -a "$tag" -m "$tag"
stage="commit and tag $tag made locally, nothing pushed."
resume="
	git push origin main $tag && gh release create $tag \"$asset\" --title $tag --generate-notes"
git push origin main "$tag"
stage="commit and tag $tag pushed to origin, GitHub release not created."
resume="
	gh release create $tag \"$asset\" --title $tag --generate-notes"
gh release create "$tag" "$asset" --title "$tag" --generate-notes
trap - EXIT
rm -rf "$asset_dir"

gh release view "$tag" --json url --jq .url
