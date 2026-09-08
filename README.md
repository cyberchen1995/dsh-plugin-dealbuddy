# dsh-plugin-dealbuddy

DealBuddy 购物研究能力的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。

商品事实仍由用户在浏览器里手动采集，插件负责读写本机 `~/.dealbuddy` 的会话与报告，
并把这些操作作为工具交给 dsh 会话里的模型。插件不持有任何模型密钥，不调用购物平台 API。

**状态：R1 骨架。** 目前只有只读能力，入库监听与其余工具在后续轮次落地。

## 当前能力

| 工具 | 作用 |
|---|---|
| `dealbuddy_list_sessions` | 列出本机会话摘要（品类、商品数、是否有报告、当前会话指针） |

随包注册名为 `dealbuddy` 的技能，无需手动拷贝到 `$DSH_HOME/skills`。

## 安装

```bash
dsh plugin --profile web add /path/to/dsh-plugin-dealbuddy
```

安装后重启 dsh。卸载：

```bash
dsh plugin --profile web remove dsh-plugin-dealbuddy
```

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖 `dealbuddy` 行的 config：

| 字段 | 默认 | 说明 |
|---|---|---|
| `port` | `8765` | 入库监听端口（R3 启用）。与 Python 工作台共存时改成别的端口，并同步修改扩展弹窗里的投递地址 |
| `dataDir` | `$DEALBUDDY_HOME` 或 `~/.dealbuddy` | 数据目录，支持 `~/` 开头 |
| `extraAllowedDomains` | `[]` | 入库 CORS 白名单追加的主机后缀 |
| `ocrTextPreviewChars` | `400` | 展示会话时保留的 OCR 文本长度 |
| `legacyOffersRoute` | `true` | 是否保留 `POST /offers` 别名 |

监听地址固定 `127.0.0.1`，不做配置。

## 开发

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

依赖锁在 `0.1.2-rc.1` 线。npm 上 `@deepseek-ai/dsh-*` 的 `latest` 标签指向已退役的 `0.0.1-rc.1`，不要放宽。

## 价格口径

`estimated_payable` 一律称「估算应付」，不得称结算价、到手价或最低价。
报告是四槽摘要（最符合需求 / 最低预算 / 综合性价比 / 值得加预算）加不推荐项，
不是候选全集：合规但既非最优也非最便宜的商品不会出现在报告里。
