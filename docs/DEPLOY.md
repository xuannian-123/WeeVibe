# 部署

线上地址：https://ju.yuanshengzhe.com（阿里云 ECS 8.133.220.184，Ubuntu 24.04，与 yuanshengzhe.com 主站共用一台机器）

## 日常发布

```bash
bash scripts/deploy.sh
```

本地构建 standalone 包 → 上传到 `/opt/juzhang/releases/<时间戳>` → `current` 软链切过去 → 重启服务 → 健康检查。只保留最近 5 个版本。

回滚：`sudo ln -sfn /opt/juzhang/releases/<旧版本> /opt/juzhang/current && sudo systemctl restart juzhang`

## 服务器上的东西

| 位置 | 作用 |
|---|---|
| `/etc/juzhang.env`（600，root） | 生产环境变量：各种 key、`PORT=3100`、`JUZHANG_DB` |
| `/etc/systemd/system/juzhang.service` | 以 `juzhang` 系统用户运行，崩溃 3 秒后自动重启，开机自启 |
| `/var/lib/juzhang/juzhang.db` | 生产数据库，独立于发布目录，重新部署不会丢 |
| `/etc/nginx/sites-available/juzhang` | 反向代理到 127.0.0.1:3100；HTTPS 由 certbot 管理并自动续期 |

改 key：`sudo nano /etc/juzhang.env && sudo systemctl restart juzhang`
看日志：`sudo journalctl -u juzhang -f`

## 注意

- 主站 `yuanshengzhe.com` 的 nginx 配置没有动过；改 nginx 前先 `sudo nginx -t`。
- **不要在生产环境跑 `scripts/smoke.ts`**：它创建的成员不是演示成员，会被算进 `/stats` 的真实数据。
- 路演前如需清空数据：`sudo systemctl stop juzhang && sudo mv /var/lib/juzhang/juzhang.db{,.bak} && sudo systemctl start juzhang`
