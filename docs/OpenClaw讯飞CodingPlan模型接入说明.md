# OpenClaw 讯飞 CodingPlan 模型接入说明

## 1. 当前接入状态

OpenClaw 本机配置中已经接入讯飞 CodingPlan 的 OpenAI-compatible 接口。

当前默认模型：

```text
xfyun/astron-code-latest
```

模型配置：

```text
provider: xfyun
baseUrl: https://maas-coding-api.cn-huabei-1.xf-yun.com/v2
modelId: astron-code-latest
api: openai-completions
```

注意：

- API Key 不写入本仓库文档。
- OpenClaw 配置查看时会自动打码为 `__OPENCLAW_REDACTED__`。

## 2. 已验证命令

查看 provider 配置：

```powershell
openclaw config get models
```

查看模型列表：

```powershell
openclaw models list --provider xfyun --plain
```

期望输出：

```text
xfyun/astron-code-latest
```

设置默认模型：

```powershell
openclaw models set xfyun/astron-code-latest
```

查看当前默认模型：

```powershell
openclaw models status --plain
```

期望输出：

```text
xfyun/astron-code-latest
```

## 3. 推理测试

已执行：

```powershell
openclaw infer model run --local --model xfyun/astron-code-latest --prompt "只回复两个字：成功"
```

实际返回：

```text
成功
```

说明模型接口真实可用，不只是配置存在。

## 4. 当前链路中的位置

目前已经接入并验证的是：

```text
OpenClaw -> 讯飞 CodingPlan 模型
```

本机桥梁服务已经支持可选 OpenClaw 指令解析：

```text
飞书
  -> 桥梁服务
  -> 固定格式解析失败时调用 OpenClaw
  -> 讯飞 CodingPlan 模型输出 JSON 参数
  -> GitHub API
  -> GitHub Actions
  -> UItest
```

已验证自然语言：

```text
帮我跑一下 main 分支的 UI 自动化冒烟测试
```

解析结果：

```json
{"targetRef":"main","runMode":"smoke"}
```

也就是说：

- 模型 provider 已接入 OpenClaw。
- 本机桥梁服务已经能调用 OpenClaw 做自然语言解析。
- 云服务器也已经安装并配置 OpenClaw，因此公网飞书回调可以直接使用自然语言指令。

## 5. 下一步可选增强

可以继续做两种集成方式：

### 方式 A：保留当前桥梁服务

飞书指令固定格式：

```text
/run-ui-test main contracts
```

桥梁服务直接触发 GitHub Actions。

优点：

- 稳定
- 简单
- 已经验证成功

### 方式 B：桥梁服务调用 OpenClaw

链路改成：

```text
飞书
  -> 桥梁服务
  -> OpenClaw agent
  -> 讯飞 CodingPlan 模型解析指令
  -> GitHub Actions
```

优点：

- 更符合“飞书龙虾下达自然语言指令”的作业描述

本机已经完成：

- 桥梁服务支持 `OPENCLAW_PARSE_ENABLED=true`
- 支持模型 `xfyun/astron-code-latest`
- 支持把冒烟测试解析成 `runMode=smoke`

云服务器已经完成：

- 安装 OpenClaw
- 配置讯飞 CodingPlan 模型
- 在 `/etc/openclaw-feishu-bridge.env` 中设置：

```text
OPENCLAW_PARSE_ENABLED=true
OPENCLAW_MODEL=xfyun/astron-code-latest
```

- 重启服务：

```bash
systemctl restart openclaw-feishu-bridge
```

已验证公网自然语言指令：

```text
帮我跑一下 main 分支的 UI 自动化冒烟测试
```

验证结果：

```text
commandSource=openclaw
runMode=smoke
GitHub Actions success
```

## 6. 结果通知

桥梁服务现在已经能在触发 GitHub Actions 后查询对应的 workflow run。

服务器配置飞书应用凭证后，可以把最终结果主动发回飞书：

```text
FEISHU_RESULT_NOTIFY_ENABLED=true
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CARD_ENABLED=true
```

通知内容包含：

- 成功或失败
- 分支
- 测试模式
- GitHub Actions run 链接
- Allure 报告入口
- 报告和失败日志查看提示

普通聊天也可以启用：

```text
OPENCLAW_CHAT_ENABLED=true
```

这样用户发“你好”“帮助”以外的普通问题时，机器人会像项目助手一样回复；只有看起来像 UI 自动化请求的消息才会进入测试触发流程。
