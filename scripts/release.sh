#!/usr/bin/env bash
# Phát hành phiên bản mới:  npm run release -- 0.2.0
#  1. Kiểm tra CHANGELOG.md đã có mục "## [0.2.0]"
#  2. Đặt version cho package.json (gốc + apps)
#  3. typecheck + test
#  4. commit "release: v0.2.0" + tag v0.2.0
# Sau đó: git push && git push --tags  → GitHub Actions build image + tạo Release.
set -euo pipefail
V="${1:?Cách dùng: npm run release -- X.Y.Z}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "Phiên bản không hợp lệ: $V"; exit 1; }
grep -Eq "^## \[?$V\]?" CHANGELOG.md || { echo "CHANGELOG.md chưa có mục '## [$V]'"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Còn thay đổi chưa commit"; exit 1; }
for f in package.json apps/api/package.json apps/web/package.json; do
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('$f'));p.version='$V';fs.writeFileSync('$f',JSON.stringify(p,null,2)+'\n')"
done
npm install --package-lock-only >/dev/null
npm run typecheck && npm test
git add -A
# Bản đầu tiên version đã đúng sẵn → không có gì để commit, chỉ gắn tag.
git diff --cached --quiet || git commit -m "release: v$V"
git tag "v$V"
echo "✓ Đã tạo tag v$V. Đẩy lên:  git push && git push --tags"
