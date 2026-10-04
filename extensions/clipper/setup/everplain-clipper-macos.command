#!/bin/bash
# Everplain Clipper: prepare trusted files; browser installation stays manual.
# No sudo, policy changes, quarantine removal, browser-profile writes or credentials.
set -euo pipefail
umask 077
FILES=(manifest.json popup.html popup.css popup.js capture.js THIRD_PARTY_LICENSES.txt)
BASE_URL='https://e.qunxue.xyz/downloads'
SITE_URL='https://e.qunxue.xyz/app'

fail() { printf '\n准备未完成：%s\n可回到官网选择“手动下载 ZIP”，不需要修改系统安全设置。\n' "$*" >&2; return 1; }
sha() { shasum -a 256 < "$1" | cut -d ' ' -f 1; }
read_checksums() {
  local file="$1" hash name extra index=0
  HASHES=()
  [ "$(wc -c < "$file")" -le 4096 ] || { fail '校验清单过大'; return 1; }
  while read -r hash name extra; do
    [[ "$hash" =~ ^[0-9a-f]{64}$ ]] && [ -z "$extra" ] || { fail '校验清单格式无效'; return 1; }
    if [ "$index" -eq 0 ]; then
      [ "$name" = 'everplain-clipper.zip' ] || { fail '校验清单缺少安装包'; return 1; }
    else
      [ "$index" -le "${#FILES[@]}" ] && [ "$name" = "${FILES[$((index-1))]}" ] || { fail '校验清单包含未知文件'; return 1; }
    fi
    HASHES+=("$hash"); index=$((index+1))
  done < "$file"
  [ "$index" -eq 7 ] || { fail '校验清单不完整'; return 1; }
}
validate_package() {
  local archive="$1" checksums="$2" entries expected
  read_checksums "$checksums" || return 1
  [ "$(wc -c < "$archive")" -le 8388608 ] || { fail '安装包超过大小限制'; return 1; }
  [ "$(sha "$archive")" = "${HASHES[0]}" ] || { fail '下载校验失败，请稍后重新运行'; return 1; }
  # Match the entire central-directory listing, including count, before reading any entry.
  # The package is intentionally flat. No directories, duplicate names or unknown files.
  entries=$(unzip -Z -1 "$archive") || { fail '下载内容不是有效 ZIP'; return 1; }
  expected=$(printf '%s\n' "${FILES[@]}" | LC_ALL=C sort)
  [ "$(printf '%s\n' "$entries" | LC_ALL=C sort)" = "$expected" ] || { fail 'ZIP 文件列表无效'; return 1; }
  # Links are never extracted; additionally reject their metadata explicitly.
  if unzip -Z -l "$archive" | LC_ALL=C grep -Eq '^l[rwx-]{9}'; then fail 'ZIP 不允许符号链接'; return 1; fi
}
verify_directory() {
  local dir="$1" index=0 file
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 1
  [ "$(find "$dir" ! -path "$dir" | wc -l | tr -d ' ')" = 6 ] || return 1
  for file in "${FILES[@]}"; do
    index=$((index+1))
    [ -f "$dir/$file" ] && [ ! -L "$dir/$file" ] && [ "$(sha "$dir/$file")" = "${HASHES[$index]}" ] || return 1
  done
}
prepare_package() {
  local archive="$1" checksums="$2" root="$3" stage file index=0 destination
  validate_package "$archive" "$checksums" || return 1
  [ -d "$root" ] && [ ! -L "$root" ] || { fail '安装目录不可用'; return 1; }
  destination="$root/release-${HASHES[0]}"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    verify_directory "$destination" || { fail '同版本目录已有其他内容，已保留原文件，请使用手动安装'; return 1; }
    INSTALL_PATH="$destination"; return 0
  fi
  stage=$(mktemp -d "$root/.preparing.XXXXXX") || return 1
  for file in "${FILES[@]}"; do
    index=$((index+1))
    # Stream known entries into newly created regular files, never unzip paths/links.
    # A per-file OS write limit also bounds malformed/bomb archive output.
    if ! (ulimit -f 8192; unzip -p "$archive" "$file" > "$stage/$file") || [ "$(sha "$stage/$file")" != "${HASHES[$index]}" ]; then
      rm -rf -- "$stage"; fail '扩展文件校验失败'; return 1
    fi
  done
  if ! verify_directory "$stage"; then rm -rf -- "$stage"; fail '扩展文件不完整'; return 1; fi
  # Exclusive mkdir never replaces an existing path, including a concurrent setup.
  if ! mkdir "$destination"; then rm -rf -- "$stage"; fail '目录同时被另一个安装占用，请重试'; return 1; fi
  for file in "${FILES[@]}"; do mv -n "$stage/$file" "$destination/$file"; done
  rmdir "$stage"
  verify_directory "$destination" || { fail '安装目录验证未完成，已保留文件'; return 1; }
  INSTALL_PATH="$destination"
}
ensure_private_directory() {
  [ ! -L "$1" ] || { fail '安装路径不允许符号链接'; return 1; }
  if [ ! -e "$1" ]; then mkdir "$1"; fi
  [ -d "$1" ] || { fail '安装路径已被文件占用'; return 1; }
}
download() {
  local url="$1" output="$2" limit="$3" status
  # TLS verification remains on. Redirects are deliberately not followed.
  status=$(ulimit -f $(( (limit + 1023) / 1024 )); curl -q --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 90 --max-filesize "$limit" --output "$output" --write-out '%{http_code}' "$url") || return 1
  [ "$status" = 200 ] && [ "$(wc -c < "$output")" -le "$limit" ] || { fail '服务器未返回完整文件'; return 1; }
}
main() {
  [ "$(uname -s)" = Darwin ] || { fail '这个脚本只适用于 macOS'; return 1; }
  printf 'Everplain 收藏助手 · 自动准备\n将从 e.qunxue.xyz 下载并校验扩展，保留浏览器的安装确认。\n不会修改浏览器策略，也不会读取登录信息。\n\n'
  local root="$HOME/Library/Application Support/Everplain" browser='' ext_url='' choice temp
  ensure_private_directory "$root"
  ensure_private_directory "$root/Clipper"
  root="$root/Clipper"
  temp=$(mktemp -d "$root/.download.XXXXXX")
  DOWNLOAD_TEMP="$temp"
  download "$BASE_URL/everplain-clipper.sha256" "$temp/package.sha256" 4096
  download "$BASE_URL/everplain-clipper.zip" "$temp/package.zip" 8388608
  prepare_package "$temp/package.zip" "$temp/package.sha256" "$root"
  rm -rf -- "$temp"; DOWNLOAD_TEMP=''
  printf '\n文件已准备：\n%s\n\n选择使用的浏览器：1 Chrome / 2 Edge\n' "$INSTALL_PATH"
  read -r choice
  case "$choice" in
    1) browser='Google Chrome'; ext_url='chrome://extensions/' ;;
    2) browser='Microsoft Edge'; ext_url='edge://extensions/' ;;
    *) printf '未选择浏览器。请自行打开 Chrome 或 Edge 的扩展管理页。\n' ;;
  esac
  open "$INSTALL_PATH" || true
  if [ -n "$browser" ]; then
    open -a "$browser" "$ext_url" "$SITE_URL" || printf '未能自动打开浏览器，请手动打开 %s 和 %s\n' "$ext_url" "$SITE_URL"
  fi
  printf '\n最后两步由你确认：\n1. 在扩展管理页打开“开发者模式”，点击“加载已解压的扩展程序”。\n2. 选择上面已打开的文件夹，再在同一个浏览器用户资料中登录 Everplain。\n\n扩展地址已预填 https://e.qunxue.xyz。首次收藏时核对并允许该站点；书签权限仅在你选择导入书签时申请。\n不要移动或删除准备好的目录。重新运行会保留旧版本，新版本需要重新选择文件夹加载。\n公司管理或系统安全提示阻止时请停止，改用官网手动 ZIP，或联系管理员。\n'
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  # Keep Finder's Terminal window open so errors and the exact folder remain readable.
  DOWNLOAD_TEMP=''
  trap 'result=$?; [ -z "$DOWNLOAD_TEMP" ] || rm -rf -- "$DOWNLOAD_TEMP"; printf "\n按回车关闭…"; read -r _ || true; exit "$result"' EXIT
  main "$@"
fi
