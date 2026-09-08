---
name: dealbuddy
description: 用 DealBuddy 在淘宝、天猫、京东做本地购物研究。商品事实由用户在浏览器里手动采集，dsh 插件保存会话与报告并提供 dealbuddy_ 工具给模型读写。不调用购物平台 API、不做浏览器自动化、不导出 Cookie、不下单结算。
---

# DealBuddy

## Overview

DealBuddy 购物搭子是本地优先的购物研究工具。商品事实来自用户在真实商品详情页手动采集，
dsh 插件负责保存会话与报告，并把操作作为 `dealbuddy_` 前缀的工具交给当前对话的模型。
插件不持有模型密钥，不调用购物平台 API。

追问不需要额外工具。用户在当前对话里直接提问，模型可以调用下面的工具查看商品和报告。

## Workflow

### 0. 安装（仅首次）

插件安装：

```bash
dsh plugin --profile <profile> add dsh-plugin-dealbuddy
```

装完重启 dsh。插件随包注册技能，无需手动拷贝。

浏览器扩展从 https://github.com/cyberchen1995/DealBuddy/releases/latest 下载
`dealbuddy-capture` zip 并解压。**加载扩展必须由用户在浏览器里手动完成**：
告知用户解压目录路径，请用户打开 `chrome://extensions`、开启「开发者模式」、
用「加载已解压的扩展程序」指向该目录。agent 不代替用户操作浏览器。

### 1. 会话管理

- `dealbuddy_list_sessions`：列出本机会话摘要（品类、商品数、是否有报告、当前会话指针）。
- `dealbuddy_create_session`：新建会话并设为当前。
- `dealbuddy_show_session`：查看某个会话的商品明细（OCR 文本默认截断）。
- `dealbuddy_set_current_session`：切换扩展投递的目标会话。

已有合适会话时不要重复创建。

### 2. 引导手动采集

扩展默认投递到：

```
http://127.0.0.1:8765/api/current/offers
```

如果本机同时运行 Python 工作台占用 8765，需要把插件 `port` 配成其他端口（如 8766），
并在扩展弹窗里把投递地址改成同一个端口。

agent 不自动浏览商品页，不读取 Cookie，不处理登录态。
遇到平台登录、验证码或风控提示时，由用户在浏览器里自行处理。

### 3. 分析与需求迭代

- `dealbuddy_get_report`：读取 Markdown 选品报告。
- `dealbuddy_refine_requirements`：更新需求。**破坏性操作：会清空该会话已采集的全部商品和报告。** 调用前必须告知用户将丢失哪些数据，得到确认后再调用。
- `dealbuddy_add_offer`：手工补一条已有结构化事实的商品。
- `dealbuddy_remove_offer`：按商品链接删除一条商品。

### 4. 解释结果

报告包含四个槽位（最符合需求 / 最低预算 / 综合性价比 / 值得加预算）加不推荐项，不是候选全集。
一个满足硬性要求但既非最优也非最便宜的商品不会出现在报告里。
向用户解释商品时，必须用 `dealbuddy_show_session` 查看全部商品，不能只读报告。

按用户目标组织输出，不机械朗读字段。保留商品链接、SKU、页面展示价、优惠条件、
采集时间、数据可信度和报告中的价格边界说明。

`estimated_payable` 只能称为「估算应付」，不能描述为结算价、到手价或最低价。

报告免责句原文：

> 价格来自页面可见信息。估算应付只计算页面明确展示且可直接解析的优惠，不代表结算价格。

## Guardrails

- 不调用购物平台 API，不做浏览器自动化抓取。
- 不读取或复制用户 Chrome Profile，不导出 Cookie、密码或登录凭据。
- 不破解验证码，不使用代理池、账号池或指纹伪造。
- 不点击购物车、结算、订单或支付入口。
- 不把销量、评价数或平台标签单独当作商品质量结论。
- 页面证据冲突时，以最近一次采集为准，并提示用户需要复核。
- `dealbuddy_refine_requirements` 调用前必须向用户说明将清空商品和报告，未经确认不调用。
