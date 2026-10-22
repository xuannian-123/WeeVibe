#!/usr/bin/env bash
# 一键部署到 ju.yuanshengzhe.com：本地构建 standalone 包 → 上传 → 切换版本 → 重启服务。
# 用法：bash scripts/deploy.sh
# 首次部署前服务器上需要已有 /etc/juzhang.env、juzhang.service 和 nginx 站点（见 docs/DEPLOY.md）。
set -euo pipefail

HOST=admin@8.133.220.184
KEY=~/.ssh/yuanshengzhe_deploy
SSH="ssh -i $KEY -o BatchMode=yes $HOST"
DIST=.next-build
REL=$(date +%Y%m%d-%H%M%S)

cd "$(dirname "$0")/.."

echo "==> 构建"
rm -rf "$DIST"
NEXT_DIST_DIR=$DIST npx next build >/dev/null

echo "==> 打包"
STAGE=$(mktemp -d)
cp -r "$DIST/standalone/." "$STAGE/"
rm -rf "$STAGE/data"                       # 本地开发库不能带上线
mkdir -p "$STAGE/$DIST"
cp -r "$DIST/static" "$STAGE/$DIST/static"
[ -d public ] && cp -r public "$STAGE/public"
tar -czf "$STAGE.tgz" -C "$STAGE" .

echo "==> 上传 $REL"
scp -q -i $KEY "$STAGE.tgz" "$HOST:/tmp/juzhang-$REL.tgz"
$SSH "set -e
  sudo mkdir -p /opt/juzhang/releases/$REL
  sudo tar -xzf /tmp/juzhang-$REL.tgz -C /opt/juzhang/releases/$REL
  rm /tmp/juzhang-$REL.tgz
  sudo chown -R juzhang:juzhang /opt/juzhang/releases/$REL
  sudo ln -sfn /opt/juzhang/releases/$REL /opt/juzhang/current
  sudo systemctl restart juzhang
  # 只保留最近 5 个版本
  ls -1dt /opt/juzhang/releases/* | tail -n +6 | xargs -r sudo rm -rf"
rm -rf "$STAGE" "$STAGE.tgz"

echo "==> 健康检查"
sleep 3
curl -fsS -o /dev/null -w "https://ju.yuanshengzhe.com → %{http_code}\n" https://ju.yuanshengzhe.com/api/stats
