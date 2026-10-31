#!/usr/bin/env bash
# 部署预览版：同一个域名，浏览器打开 /__preview/on 之后看到的是预览版，/__preview/off 切回线上版。其他人不受影响。
# 预览版跑在本机 3101（systemd: juzhang-preview），用线上库的一份副本（每次部署重新复制），任何操作都不碰线上数据。
# 用法：bash scripts/deploy-preview.sh        撤掉预览：bash scripts/deploy-preview.sh --remove
set -euo pipefail

HOST=admin@8.133.220.184
KEY=~/.ssh/yuanshengzhe_deploy
SSH="ssh -i $KEY -o BatchMode=yes $HOST"
DIST=.next-preview-build
REL=$(date +%Y%m%d-%H%M%S)
SITE=/etc/nginx/sites-enabled/juzhang

cd "$(dirname "$0")/.."

if [ "${1:-}" = "--remove" ]; then
  $SSH "set -e
    sudo systemctl disable --now juzhang-preview 2>/dev/null || true
    if sudo grep -q juzhang_upstream $SITE; then
      sudo cp $SITE.before-preview $SITE
      sudo nginx -t && sudo systemctl reload nginx
    fi
    echo removed"
  exit 0
fi

echo "==> 构建"
rm -rf "$DIST"
NEXT_DIST_DIR=$DIST npx next build >/dev/null

echo "==> 打包"
STAGE=$(mktemp -d)
cp -r "$DIST/standalone/." "$STAGE/"
rm -rf "$STAGE/data"
mkdir -p "$STAGE/$DIST"
cp -r "$DIST/static" "$STAGE/$DIST/static"
[ -d public ] && cp -r public "$STAGE/public"
tar -czf "$STAGE.tgz" -C "$STAGE" .
rm -rf "$DIST"

echo "==> 上传 $REL"
scp -q -i $KEY "$STAGE.tgz" "$HOST:/tmp/juzhang-preview-$REL.tgz"
$SSH "set -e
  sudo mkdir -p /opt/juzhang-preview/releases/$REL /var/lib/juzhang-preview/photos
  sudo tar -xzf /tmp/juzhang-preview-$REL.tgz -C /opt/juzhang-preview/releases/$REL
  rm /tmp/juzhang-preview-$REL.tgz
  sudo chown -R juzhang:juzhang /opt/juzhang-preview/releases/$REL /var/lib/juzhang-preview
  sudo ln -sfn /opt/juzhang-preview/releases/$REL /opt/juzhang-preview/current
  ls -1dt /opt/juzhang-preview/releases/* | tail -n +4 | xargs -r sudo rm -rf

  # 线上库的一份副本（VACUUM INTO 在线一致地复制，不影响线上服务）
  sudo rm -f /var/lib/juzhang-preview/juzhang.db /var/lib/juzhang-preview/juzhang.db-wal /var/lib/juzhang-preview/juzhang.db-shm
  sudo /usr/local/bin/node -e \"new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec(\\\"VACUUM INTO '\\\" + process.argv[2] + \\\"'\\\")\" /var/lib/juzhang/juzhang.db /var/lib/juzhang-preview/juzhang.db
  sudo chown juzhang:juzhang /var/lib/juzhang-preview/juzhang.db

  # 环境变量：线上的那份，改端口、库、照片目录
  sudo sh -c 'grep -vE \"^(PORT|JUZHANG_DB|JUZHANG_PHOTOS_DIR)=\" /etc/juzhang.env > /etc/juzhang-preview.env; printf \"PORT=3101\nJUZHANG_DB=/var/lib/juzhang-preview/juzhang.db\nJUZHANG_PHOTOS_DIR=/var/lib/juzhang-preview/photos\n\" >> /etc/juzhang-preview.env; chmod 600 /etc/juzhang-preview.env'

  sudo tee /etc/systemd/system/juzhang-preview.service >/dev/null <<'UNIT'
[Unit]
Description=AI 局长 预览版 (ju.yuanshengzhe.com/__preview/on)
After=network.target

[Service]
User=juzhang
Group=juzhang
WorkingDirectory=/opt/juzhang-preview/current
EnvironmentFile=/etc/juzhang-preview.env
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/juzhang-preview

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable juzhang-preview >/dev/null 2>&1
  sudo systemctl restart juzhang-preview

  # nginx：按 cookie 选上游（第一次才改，改之前留底；nginx -t 不过就恢复）
  if ! sudo grep -q juzhang_upstream $SITE; then
    sudo cp $SITE $SITE.before-preview
    sudo python3 - $SITE <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
head = 'map \$cookie_jz_preview \$juzhang_upstream {\n    default 127.0.0.1:3100;\n    \"1\" 127.0.0.1:3101;\n}\n\n'
loc = '''    # 预览版开关：只影响打开它的这个浏览器
    location = /__preview/on {
        add_header Set-Cookie \"jz_preview=1; Path=/; Max-Age=604800; Secure; SameSite=Lax\";
        return 302 /;
    }
    location = /__preview/off {
        add_header Set-Cookie \"jz_preview=; Path=/; Max-Age=0; Secure; SameSite=Lax\";
        return 302 /;
    }

    location / {'''
s = s.replace('    location / {', loc, 1).replace('proxy_pass http://127.0.0.1:3100;', 'proxy_pass http://\$juzhang_upstream;', 1)
open(p, 'w', encoding='utf-8').write(head + s)
PY
    if ! sudo nginx -t 2>/dev/null; then sudo cp $SITE.before-preview $SITE; echo 'nginx 配置不过，已恢复' >&2; exit 1; fi
    sudo systemctl reload nginx
  fi"
rm -rf "$STAGE" "$STAGE.tgz"

echo "==> 健康检查"
sleep 4
$SSH "curl -fsS -o /dev/null -w 'preview 127.0.0.1:3101 → %{http_code}\n' 127.0.0.1:3101/api/stats; curl -fsS -o /dev/null -w 'live    127.0.0.1:3100 → %{http_code}\n' 127.0.0.1:3100/api/stats"
echo "预览：手机浏览器打开 https://ju.yuanshengzhe.com/__preview/on （切回线上：/__preview/off）"
