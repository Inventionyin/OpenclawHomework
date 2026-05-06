# Hermes/OpenClaw 生态技能与高级玩家路线

本文记录 2026-05-06 对用户提到的 5 个“高级龙虾玩家插件/skill”名称的落地策略。目标不是盲目安装所有搜索结果，而是让 OpenClaw/Hermes 具备可控的生态导航、记忆检索、后台自检和后续升级能力。

## 1. 五个名称的判断

| 名称 | 当前判断 | 自动安装策略 | 说明 |
| --- | --- | --- | --- |
| GBrain | 可信核心项 | 自动安装/检测 | 作为旁路脑库，接入 `docs/`、`data/memory`、`data/qa-assets`。 |
| G Stack | 概念/技能栈 | 不单独安装 | 暂未确认独立官方仓库，按 GBrain skill 思路吸收。 |
| Hermes WebUI | 候选项 | 先登记，不强装 | 不把搜索到的第三方 WebUI 当生产官方组件。 |
| awesome Hermes agent | 生态目录 | 同步到脑库/学习 | 目录类资料，不是运行时插件。 |
| Hermes agent self evolution | 研究项 | 只做候选 | 自进化类风险较高，不默认接管生产机器人。 |

## 2. 已新增的项目能力

- `scripts/ecosystem-manager.js`：生态插件状态、可信安装计划、巡检状态写入。
- `scripts/install-ecosystem-maintenance.sh`：安装每天运行的 systemd timer。
- `npm run ecosystem:status`：查看生态状态。
- `npm run ecosystem:install`：只安装白名单可信项。
- `npm run ecosystem:maintenance`：执行一次状态巡检。
- 飞书自然语言入口：
  - `查看生态插件状态`
  - `给 Hermes 安装 GBrain、Hermes WebUI 和自检更新技能`
  - `开启记忆自我净化和后台自检`

## 3. 安全边界

自动执行只允许可信且 `supported` 的项目，目前只有 GBrain。候选、目录、研究项只记录到状态和文档，不自动跑陌生脚本。

后台“自我净化”不是让模型随意改代码，而是做这些可审计工作：

- 检查 GBrain 是否存在。
- 检查生态状态文件。
- 汇总候选插件和风险。
- 同步本项目文档、记忆和 QA 资产到脑库。
- 发现缺项时写入建议，不直接执行高风险安装。

## 4. 服务器检查命令

```bash
cd /opt/OpenclawHomework
npm run ecosystem:status
npm run ecosystem:maintenance
systemctl list-timers '*ecosystem-maintenance*' --no-pager
```

Hermes 侧如果要刷新 GBrain：

```bash
cd /opt/OpenclawHomework
bash scripts/sync-gbrain-knowledge.sh
```

