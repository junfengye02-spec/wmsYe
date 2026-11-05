# 部署与运维

本目录通过 Docker Compose 运行 wmsYe 成品仓 WMS：自定义 InvenTree Web、异步 worker、PostgreSQL 17、Redis 7 和 Caddy。源代码位于同级 `InvenTree/`，基础镜像版本为 InvenTree 1.5.1。

## 首次部署

安装 Docker（含 Compose v2）、Node.js 24 和 Corepack。从仓库根目录执行：

```bash
cp inventree-deploy/.env.example inventree-deploy/.env
```

编辑 `.env`，至少填写非空数据库密码，并将 `INVENTREE_SITE_HOST` 与 `INVENTREE_SITE_URL` 改为实际地址。`localhost` 只适合部署机本身访问；局域网终端使用部署机 IP 或可解析的域名。

```bash
# 编译语言包、前端，生成 wmsye-inventree:dev
bash InvenTree/contrib/container/build-wms.sh

cd inventree-deploy
mkdir -p inventree-data
chmod 600 .env
docker compose config --quiet
docker compose up -d inventree-db inventree-cache

# 首次空库初始化；跳过尚不存在的数据备份
docker compose run --rm inventree-server invoke update --skip-backup
docker compose run --rm inventree-server invoke superuser
docker compose up -d
docker compose ps
```

`invoke superuser` 交互创建管理员。不要将账号密码写进 README 或提交 `.env`。启动后建立库位、商品、项目及合同，分配操作和审批权限，并配置库位审批 Owner。是否启用扫码审批及其时限由系统业务设置控制，不由示例环境变量自动创建。

构建脚本按 `yarn.lock` 安装依赖，并要求前端构建产物包含 `ScanStockPage.tsx`。正常构建只编译现有翻译；需要提取新文案时使用 `WMS_EXTRACT_TRANSLATIONS=1 bash InvenTree/contrib/container/build-wms.sh`。不要使用官方 `stable` 镜像代替二开镜像，否则不会获得本项目功能。

## 环境变量

完整起点为 [.env.example](.env.example)。示例密码留空，Compose 会拒绝空数据库密码。

| 变量 | 用途 |
| --- | --- |
| `INVENTREE_IMAGE` | 本地构建镜像，默认示例为 `wmsye-inventree:dev` |
| `INVENTREE_EXT_VOLUME` | 持久化路径，示例为 `./inventree-data` |
| `INVENTREE_DB_ENGINE/HOST/PORT/NAME/USER/PASSWORD` | PostgreSQL 连接；容器主机为 `inventree-db` |
| `INVENTREE_CACHE_ENABLED/HOST/PORT/DB` | Redis 缓存；容器主机为 `inventree-cache` |
| `INVENTREE_WEB_PORT` | 应用内部端口，当前配置使用 `8000` |
| `INVENTREE_SITE_HOST` | Caddy 站点主机名或 IP，不带协议、路径 |
| `INVENTREE_SITE_URL` | 外部完整 HTTPS 地址，与站点主机匹配 |
| `INVENTREE_HTTP_PORT/HTTPS_PORT` | 宿主机端口，示例为 `8088` / `443` |
| `INVENTREE_TIMEZONE` | 应用时区，示例为 `Asia/Shanghai` |
| `INVENTREE_WECOM_BOT_WEBHOOK_URL` | 可选，企业微信群机器人地址 |
| `INVENTREE_WECOM_BOT_MENTION_USER_IDS` | 可选，提交审批时提醒的 userId，逗号分隔 |
| `INVENTREE_LOCAL_PRINT_*` | 可选，本地打印开关、版本和下载地址 |

Caddy 的 HTTP 跳转默认指向 HTTPS 443；修改外部 HTTPS 端口时需要同时调整 Caddy 跳转目标。Compose 明确使用固定容器名，在同一 Docker 主机部署第二套环境时应另行隔离容器名、端口、数据库及数据目录。

## HTTPS 与局域网访问

Caddy 默认以内部 CA 签发证书，并把 HTTP 跳转到 HTTPS。PostgreSQL、Redis 和应用端口不发布到宿主机；对外发布的 HTTP/HTTPS 端口绑定 `0.0.0.0`。

首次启动后，可从当前代理容器导出**公钥根证书**：

```bash
docker compose cp inventree-proxy:/data/caddy/pki/authorities/local/root.crt ./inventree-local-ca.crt
```

将这张根证书导入需要访问本站的终端信任库；不要分发 CA 私钥。之后访问 `.env` 中的 HTTPS 地址。更换主机 IP 或域名时，同步更新 `INVENTREE_SITE_HOST` 和 `INVENTREE_SITE_URL`，再运行 `docker compose up -d`。公网证书部署需要另行调整 `Caddyfile` 的 `tls internal` 配置。

## 日常维护与升级

### 当前 Mac 的 Cloudflare Tunnel 入口

2026-10-19，本机最新功能实例通过 `https://wms.0000238.xyz` 访问。Cloudflare 的 `Mac` Tunnel 将原 `mesmac.0000238.xyz` 路由改为 `wms.0000238.xyz → http://localhost:18000`，DNS 指向同一条 Tunnel。只改 DNS 名称不会自动修改 Tunnel 内的 hostname 路由。

此入口连接 `wms-preview-proxy → wms-preview`，使用已有预览数据库 `wms_inventory_acceptance` 和 `wms-preview-worker`；不是下方默认 Compose 的旧 `inventree-server` 实例。Web 与 worker 的 `INVENTREE_SITE_URL` 为公网 HTTPS 地址，`INVENTREE_TRUSTED_ORIGINS` 包含该地址并保留原局域网来源。`Caddyfile.preview` 为此域名向 Django 传递 HTTPS 协议。

2026-11-02 已更新当前预览实例的设备列表及资料表单（品牌、规格、型号）、统一扫码待办流程和 50 × 30 mm 设备标签。前端原入口文件备份于 `InvenTree/tmp/contract-warranty/backups/equipment-columns-20261102-113606/`，旧资源文件保留；打印模板回退清单位于容器内 `/home/inventree/data/equipment-labels-before-20261102-columns.json`。设备资料中的空品牌未自动补写。

同日已统一设备列表的文件导入、Excel 导出和空白模板。列名与顺序共用设备基础资料定义，导出按当前筛选范围生成完整 Excel，修改后可重新导入；预览与提交均校验设备ID，且不会修改库存数量。此次前端入口备份于 `InvenTree/tmp/contract-warranty/backups/equipment-template-20261102-115327/`，后端无需数据库迁移。

2026-11-04 已部署扫码作业、独立统计查询及单据附件后补版本至上述当前实例；执行 `stock.0139_wms_business_documents` 并重启 Web／worker。部署前数据库、媒体、前端与容器配置备份保存在本机受保护目录 `~/.wms-backups/ui-statistics-20261104-100322/`；迁移前后库存记录校验一致。公网统计页面、已完成申请附件读取、前端资源及健康接口验证通过。

Mac 必须保持开机、联网且不休眠，Docker Desktop 和 cloudflared 必须运行。cloudflared 已由系统 LaunchDaemon 启动，应用容器保留 `unless-stopped` 重启策略。Docker Desktop 启动后可以检查：

2026-10-21 排障补充：当前网络下系统 Tunnel 的 QUIC 连接持续超时，公网返回 Cloudflare 1033。已增加当前用户的 `com.wms.cloudflared-http2` LaunchAgent，使用 HTTP/2 连接同一条 Tunnel，登录后自动启动、退出后自动重启。启动脚本位于 `~/.local/libexec/wms-tunnel/run.py`，直接读取已有系统 LaunchDaemon 的凭据，不将凭据写入仓库。日志位于 `~/Library/Logs/wms-tunnel/`。原系统 LaunchDaemon 未修改；当前 HTTP/2 连接依赖此 Mac 用户保持登录。可用 `launchctl list com.wms.cloudflared-http2` 检查该连接进程。

```bash
docker ps --filter name=wms-preview
curl --fail https://wms.0000238.xyz/api/system/health/
```

此次修改前的 web 与 worker 容器以 `*-before-tunnel-20261019151739` 名称保留并停止，供恢复配置；未迁移或重建数据库。不要同时启动旧 worker 与当前 worker。

```bash
docker compose ps
docker compose logs --tail=100 inventree-server inventree-worker inventree-proxy
docker compose exec inventree-server invoke int.showmigrations

# 停止服务，不删除绑定的数据目录
docker compose down
```

升级前将数据库、上传媒体、配置与密钥备份到独立受保护的位置，并先在副本验证迁移。运行中的数据位于 `INVENTREE_EXT_VOLUME`；不要直接把运行中的 PostgreSQL 文件复制视为一致性备份。应用的 `invoke backup` 可备份数据库和媒体：

```bash
docker compose exec inventree-server invoke backup
```

完成备份后，从仓库根目录重新构建，再迁移并启动：

```bash
bash InvenTree/contrib/container/build-wms.sh
cd inventree-deploy
docker compose stop inventree-server inventree-worker
docker compose run --rm inventree-server invoke update
docker compose up -d
docker compose ps
```

已有数据库升级不使用 `--skip-backup`。`invoke update` 会在迁移前执行应用备份；仍需将备份复制到独立位置。涉及唯一约束或历史数据回填的迁移如果报告冲突，应核对原数据后再继续，不要跳过迁移或直接合并记录。新应用回退与数据库回退分别处理，不自动逆迁移删除审计记录。

## 扫码与审批

当前工作台支持扫码枪 HID 键盘输入。完整标签信息齐全时回车自动加入待入库；信息缺失时先补齐。同一码再次主动扫码按标签准备数量累加，兼容的待入库事件合并一行显示（例如 10 → 20）；网络重试复用原事件 ID，不重复计数。提交整单后进入原审批流程。详细规则见[业务操作指南](../docs/INVENTREE_WMS_CONTRACT_WARRANTY_GUIDE.md)。

## 企业微信群机器人

仅在 `.env` 中填写实际 Webhook，缺省留空。后台 worker 在数据库事务提交后异步通知；发送失败不会回滚库存。支持直接入库成功、申请提交、审批通过/驳回、撤销和超时；草稿逐条扫码不发群消息。发布后用专用测试群验证网络和配置。

## Windows 本地标签打印

基础部署默认关闭本地打印，保留 PDF 使用路径。启用前阅读 [Windows 本地打印手册](WINDOWS_LOCAL_PRINT.md)，准备经过验证的 QZ Tray 版本、HTTPS 下载地址和匹配的签名证书/私钥。可选 overlay：

```bash
docker compose -f docker-compose.yml -f docker-compose.local-print.yml up -d
```

overlay 要求 `WMS_LOCAL_PRINT_CERTIFICATE_FILE` 和 `WMS_LOCAL_PRINT_PRIVATE_KEY_FILE` 指向宿主机绝对路径，私钥只挂载到签名服务，不上传 GitHub。目前软件逻辑及本地模拟验收不代表 Windows 实机、驱动、出纸或实物扫码验收完成。

## 仓库内容边界

仓库只提供配置模板与代码，不包含现有业务数据库、上传媒体、生产 `.env`、证书私钥、备份、运行日志和本机测试产物。`scripts/enable-preview-*.py` 及 `PREVIEW_*.md` 用于已有隔离预览实例，包含该实例假设，不属于新环境安装流程。历史验收文档中的本地路径或日志引用不保证在新 clone 中存在。

更多资料：[开发与测试](../docs/DEVELOPMENT.md)、[部署成本清单](DEPLOYMENT_COST_CHECKLIST.md)。

### 2026-11-04 紧凑扫码、批次详情与网络失败恢复

- 当前实例仍为 `wms-preview`，前端入口 `assets/index-DFwT9z-X.js`。更新紧凑扫码、名称／型号添加、独立批次详情，以及表格无响应网络错误的就地重试；无数据库迁移。
- 发布前前端备份：`/Users/jf/.wms-backups/compact-batch-20261104-164546/frontend-build`；同目录保存部署记录。保留旧静态资源，仅替换入口清单，避免旧浏览器引用失效。
- 验证：扫码 native 41、LAN 41、统计 6、网络恢复 4、单元 28 项通过，TypeScript 与构建通过。网络中断模拟可复现旧 INVE-E17；修复后保留数据／搜索并重试恢复，403 继续按权限错误处理。
- 本实例 `STATIC_ROOT=/tmp/wms-static`，WhiteNoise 在进程启动时建立静态资源索引，因此更新前端后需要重启 web。当前启动命令会重新压缩全部保留资源，启动耗时需预留；worker 未重启。

### 2026-11-04 前端资源恢复与同码汇总

- 当前入口为 `assets/index-Br5SLB47.js`。入库准备弹窗改为打开时加载，其样式加载失败不会阻断扫码工作台；资源加载失败提供明确的重载入口，重载前提示未保存内容，不自动刷新。
- Caddy 直接只读提供 `/static/web/*`，挂载现有 `frontend-build` 到 `/var/www/frontend`。缺失资源返回 404，不回退 HTML。上线先放齐新资源并验证，再原子替换入口清单；保留旧哈希文件，支持仍打开旧页面的客户端。Django 的入口模板按 manifest 加载入口样式与静态依赖，不提前执行动态模块。
- 当前 web 已重启以加载模板修改，未改数据库；静态资源在重启期间验证返回 200。后续仅更新前端无需为 Caddy 静态文件重启 web。
- 回退资料：`/Users/jf/.wms-backups/asset-recovery-20261104-211009`，包含前端、原 Caddy 配置及受保护的代理配置。原代理容器保留为 `wms-preview-proxy-before-static-20261104211145`。回退代理时须同时恢复原 Caddy 配置，旧容器没有新增静态资源挂载。
- 本机资源完整性检查（验证证书、MIME、内容哈希，绕过系统代理）：

```bash
python3 inventree-deploy/scripts/verify-frontend-assets.py \
  --build InvenTree/tmp/contract-warranty/frontend-build \
  --origin https://localhost:18443 \
  --ca inventree-deploy/certificates/public/wms-ca.crt --direct
```

局域网访问还依赖运行主机的实际 IP；地址变化不能通过前端重试修复。不要关闭证书校验来掩盖连接问题。

本轮验证：扫码工作流 84 项、统计 6 项、表格网络恢复 4 项、生产构建资源故障恢复 4 项、同码合并浏览器测试 1 项、单元测试 34 项通过；模板测试 6 项通过，TypeScript 与生产构建通过。当前 manifest 的 267 个资源在本机 HTTPS 网关逐一核对通过。浏览器测试为隔离测试夹具，不替代登录生产环境后的实物扫码验收。

### 2026-11-05 出库同码合并

出库待办也合并相同来源、库存项、库位及业务信息的扫码事件，数量累加，撤销只删除最近一笔。后端库存校验及逐次事件不变。入口 `assets/index-DOUVGeUw.js`；备份 `/Users/jf/.wms-backups/outbound-group-20261105-090920/frontend-build`。验证：7 项汇总单元测试、2 项入出库合并浏览器测试、16 项出库工作流测试通过，TypeScript 与生产构建通过，267 个资源逐一核对通过。先发布资源后原子切换清单，无需重启服务。

### 2026-11-05 审批单统一布局

入口 `assets/index-BjKTsdtn.js`，入出库审批统一全屏明细优先布局，保留原审批权限、二次确认与整单记账。84 项扫码流程、4 项明细合并及审批布局、6 项统计页面、7 项汇总单元测试通过，TypeScript、Biome 和生产构建通过；266 个构建资源核对通过。备份 `/Users/jf/.wms-backups/approval-layout-20261105-105140/frontend-build`。资源先发布并验证，再原子切换入口清单，旧文件保留，未重启业务服务。

### 2026-11-05 空搜索候选与审批操作去重

名称／型号搜索留空也查询现有可用明细，继续沿用项目来源、入库本人及库位筛选、出库库存可用量约束和最多 100 条的查询范围。审批按钮只保留底部一组。2 项后端接口、6 项手动添加浏览器、4 项审批布局回归通过；TypeScript、构建、格式检查通过，266 个资源核验通过。入口 `assets/index-0uM3EUD0.js`，备份 `/Users/jf/.wms-backups/empty-search-20261105-112730/frontend-build`。web 重启后健康检查正常。
