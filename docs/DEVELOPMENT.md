# 开发与验证

应用源码在 `InvenTree/`，上游基线为 InvenTree 1.5.1 / `84052e1ac8087c2ede499d72310c67e74dad3017`。这是根仓库中的普通目录。上游开发指导见 [CONTRIBUTING.md](../InvenTree/CONTRIBUTING.md)，实际工具配置以当前源码为准。

## 主要代码位置

| 目录 | 内容 |
| --- | --- |
| `InvenTree/src/backend/InvenTree/stock/` | 库存、扫码、审批、冻结、项目与合同质保 |
| `InvenTree/src/backend/InvenTree/part/` | 商品、IPN 与条码约束 |
| `InvenTree/src/backend/InvenTree/report/` | 标签、PDF、本地打印任务与签名 |
| `InvenTree/src/backend/InvenTree/users/` | 业务权限 |
| `InvenTree/src/frontend/src/` | React 页面、表单、组件及业务函数 |
| `InvenTree/src/frontend/tests/` | Node 单元测试及 Playwright 测试 |
| `InvenTree/contrib/container/` | 二开镜像及构建脚本 |

扫码库存变更复用 InvenTree 原生库存模型与流水；审批及来源标签提供业务约束和审计，不维护第二套库存余额。

设备列表的文件导入、Excel 导出和空白模板统一使用 `stock/wms.py` 的 `PART_COLUMNS`：设备ID、设备名称、品牌、设备分类完整路径、型号、单位、规格、备注。设备导出沿用原生列表筛选并导出全部匹配行，使用文本单元格保留前导零和长编号。已有设备通过设备ID更新，新增设备可留空；导入只维护基础资料，不改变库存。CSV 导入仍兼容，空白可选字段保留原值。`stock.test_wms` 覆盖导出修改再导入、模板一致性及只有原生条码的旧设备匹配。

## 前端

使用 Node.js 24（本次验证环境为 24.12.0）、Corepack 与锁定的 Yarn 依赖。Node 单元测试需要类型转换开关，只有类型擦除不足以运行 TypeScript 参数属性。

```bash
cd InvenTree/src/frontend
corepack yarn install --frozen-lockfile
node --experimental-transform-types --test tests/unit/*.test.ts
corepack yarn compile
corepack yarn build
```

`build` 包含 TypeScript 检查和 Vite 生产构建。修改翻译文案时执行 `corepack yarn extract` 并审查语言文件差异，再执行 `compile`。默认镜像构建不会自动提取全部语言目录。

## 后端

扩展运行 `stock.test_api` 等上游模块时需要相应开发依赖，例如 `pytest`；生产镜像不保证自带全部测试工具。请在独立测试容器或虚拟环境中按 `InvenTree/src/backend/requirements-dev*.txt` 安装，不要向运行中的业务容器临时安装测试依赖。

优先在独立 Docker 测试环境使用构建好的二开镜像，以保持 Python 和系统依赖与部署一致。测试数据库与媒体目录必须独立，测试期间关闭真实企业微信群 Webhook。以下命令从 `inventree-deploy/` 运行，适用于专门配置的测试环境；Django 会创建/复用 `test_wms_validation`，数据库用户需要建库权限：

```bash
docker compose run --rm \
  -e INVENTREE_DB_NAME=wms_validation \
  -e INVENTREE_MEDIA_ROOT=/tmp/wms-validation-media \
  -e INVENTREE_WECOM_BOT_WEBHOOK_URL= \
  inventree-server python manage.py test \
  stock.test_wms stock.test_approval_regressions stock.test_approval_api_contract \
  stock.test_projects stock.test_contract_warranty stock.test_wecom_notifications \
  report.test_local_print report.test_local_print_templates \
  report.test_local_print_concurrency \
  --testrunner django.test.runner.DiscoverRunner --keepdb --noinput
```

迁移回归应使用新的测试数据库，不加 `--keepdb`：

```bash
docker compose run --rm \
  -e INVENTREE_DB_NAME=wms_migration_validation \
  -e INVENTREE_MEDIA_ROOT=/tmp/wms-migration-validation-media \
  -e INVENTREE_WECOM_BOT_WEBHOOK_URL= \
  inventree-server python manage.py test \
  stock.test_migrations stock.test_contract_migrations part.test_migrations \
  --testrunner django.test.runner.DiscoverRunner --noinput
```

不要把这些命令当作业务库升级命令。迁移的实际部署流程见[部署手册](../inventree-deploy/README.md)。本地 Python 开发可按上游文档使用 Invoke 开发环境；先配置独立数据库与数据目录，再运行 `invoke dev.setup-dev`、`invoke dev.server` 和 `invoke dev.frontend-server`。

## 浏览器与硬件验收

合同流程和本地打印还提供不连接业务数据库的隔离前端用例，在前端目录运行：

```bash
node node_modules/@playwright/test/cli.js test --config playwright.contract-warranty.config.ts
node node_modules/@playwright/test/cli.js test --config playwright.local-print.config.ts
```

这些用例使用测试接口和打印驱动模拟，不会向真实打印机发送任务。

Playwright 主配置会启动前端、Django 和 worker，并执行全局测试准备。必须先准备专用测试环境及浏览器依赖，再在前端目录运行：

```bash
corepack yarn playwright install chromium
corepack yarn playwright test --project=chromium
```

测试配置及用例位于 `InvenTree/src/frontend/`；已有实例专用的预览脚本不替代测试环境初始化。端到端通过不代表打印机通过：Windows 驱动、QZ Tray 信任、标签尺寸、真实出纸、二维码识别及断网/缺纸处理仍需按[打印验收交接](WINDOWS_LOCAL_PRINT_READY_FOR_WINDOWS.md)在工位实测。

## 提交约定

每个逻辑修改单独提交，模型、迁移及其直接依赖应保持可运行；功能代码和对应测试一起提交。README 与业务说明应同步更新。不要提交 `.env`、数据库、媒体、私钥、运行日志、`node_modules/`、构建产物或本地验收备份。

`docs/*ACCEPTANCE*.md` 为历史记录，保留当时范围及结果；其中引用的本地日志、截图和运行数据不入库。新版本应依据当次测试结果判断，不沿用历史“已通过”结论。

## 设备标签版式更新

品牌、规格、型号复用已有设备字段，不需要新增数据库迁移。新设备、库存及完整入库标签统一为 50 × 30 mm，文字显示设备名称、品牌、规格、型号和公司名称。二维码内容保持兼容。

已有部署的模板文件单独保存在媒体目录，升级源码或镜像后还需刷新三份标准模板。在 `inventree-deploy/` 下先预览，再生成新的备份清单并应用：

```bash
docker compose exec inventree-server python manage.py refresh_equipment_labels
docker compose exec inventree-server python manage.py refresh_equipment_labels --apply --backup /home/inventree/data/equipment-labels-before-20261102.json
```

原模板文件会保留；备份路径必须是尚不存在的新文件。需要回退时：

```bash
docker compose exec inventree-server python manage.py refresh_equipment_labels --apply --restore /home/inventree/data/equipment-labels-before-20261102.json
```

该命令保留模板启用状态，不修改库存或旧打印任务。请按 50 × 30 mm、实际大小打印，并现场确认二维码及公司名称完整。

## 仓库维护与重复入库（2026-11-02）

库存工具栏提供项目管理、合同管理、入库单管理。项目和合同支持维护及停用，已引用记录不能删除；合同验收日期与质保月数动态读取，更新不换二维码。新单据只能选启用档案，历史单据和原标签继续有效。

入库单列表按单号、项目、合同、日期与状态筛选，普通用户只维护本人单据。未使用的单据可增删设备行，删除行采用作废并保留审计，旧码拒绝使用；存在有效申请或已入库的单据不能直接增删行或改数量。设备默认库位只填空库位，冲突需明确选择统一库位或分单，历史单据位置保持不变。

出库用途选填。同一有效标签可反复入库，每次按扫码框当前数量加入独立待办事件（默认标签准备数量），审批后累加同一来源、同一实际库位的兼容库存。单据显示累计入库及待入库数量。请求去重仍以 client_event_id 和指纹为准，重复回车、网络重试不应造成重复记账；新的主动扫码使用新的事件标识。

部署需执行 stock.0137 和 stock.0138；后者移除每个来源明细只能有一次入库的限制，保留每次请求的唯一标识。执行迁移前备份数据库；重复入库数据产生后，恢复旧唯一约束需要先恢复配套数据库快照，不能仅回退应用代码。

## 扫码作业与统计查询（2026-11-04）

本次增加 `stock.0139_wms_business_documents`，包含合同项目关联和私有业务附件表。模型迁移与后端、前端构建需一起升级；应用新代码前先按部署手册备份和迁移。此轮开发验证不在业务库执行迁移。

新增独立页面 `/stock/statistics/`，复用 `/api/stock/wms/records/` 查询与导出。型号、品牌为当前基础资料；其余原有业务快照口径不变。手动选择来源使用 `/api/stock/wms/scan-candidates/`，后续仍走既有标签解析、草稿与审批接口。

业务附件接口为 `/api/stock/scan/requests/{pk}/attachments/`（GET、POST multipart）及 `/{attachment_pk}/download/`（GET）。附件允许审批前或落账后追加，记录上传人和时间，限制 PDF／PNG／JPG、10 MB。附件内容保存在数据库，不暴露公共媒体 URL；备份数据库时一并备份附件，容量规划需包括这些文件。访问权限复用审批单可见范围，写入需额外满足原申请人或审计管理权限及库存修改权限。

新增后端回归模块：`stock.test_business_documents`、`stock.test_wms_notification_summary`；测试仍使用隔离数据库、媒体目录及关闭 Webhook 的配置。合同回填测试覆盖唯一归属与跨项目历史合同，附件测试覆盖草稿和入／出库落账后上传、越权读取、无库存变化。

统计页面隔离前端回归：`node node_modules/@playwright/test/cli.js test --config playwright.wms-statistics.config.ts`。扫码与合同流程继续使用 `playwright.contract-warranty.config.ts`，包含普通浏览器及 LAN HTTP 两种环境。

### 2026-11-05 同码合并数量守恒回归

`stock.test_contract_warranty.ContractWarrantyTest` 新增五项回归：入库两次 10、出库两次 3、入／出库各撤销最近一次、出库重复扫码超过可用量。逐项核对待办数量、库存冻结、审批后库存、成功事件 `applied_quantity`、统计接口数量及批次详情接口数量；验证重复请求、重复提交、重复审批不二次记账，未审批和撤销事件不进入统计。

隔离测试库执行该类及 `WmsAcceptanceTest.test_whole_approval_failure_rolls_back`、`test_reject_expiry_and_remove_release_freezes`、`test_posting_date_and_units_all_pages`、`WmsConcurrencyTest`，共 29 项通过。界面 `playwright.pending-groups.config.ts` 2 项、`playwright.wms-statistics.config.ts` 6 项通过。没有对业务数据库写入测试数据，没有修改记账逻辑或重启业务服务。

合并仅用于待办显示。审批和统计保留逐次成功扫码事件，因此待办一行可能对应统计中的多条成功记录，数量合计一致；成功记录数不能当作设备数量。
