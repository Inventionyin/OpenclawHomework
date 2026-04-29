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

目前已经接入的是：

```text
OpenClaw -> 讯飞 CodingPlan 模型
```

当前飞书自动化链路仍然是：

```text
飞书
  -> 云服务器桥梁服务
  -> GitHub API
  -> GitHub Actions
  -> UItest
```

也就是说：

- 模型 provider 已接入 OpenClaw。
- 飞书 webhook 目前还没有改成“先交给 OpenClaw agent 再由 agent 触发 GitHub”。
- 如果老师严格要求“龙虾解析自然语言”，下一步可以把桥梁服务改成调用 OpenClaw agent。

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

需要补：

- OpenClaw gateway 常驻运行
- OpenClaw agent 调用接口
- 桥梁服务转发飞书消息给 OpenClaw
- OpenClaw 调用 GitHub 触发脚本

