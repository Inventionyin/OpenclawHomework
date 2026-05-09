function inferIntentLabel(route = {}) {
  if (route.agent === 'clerk-agent') {
    if (route.action === 'daily-email' || route.action === 'daily-email-invalid-recipient') {
      return '发送今日日报到邮箱';
    }
    if (route.action === 'daily-report') {
      return '查看日报预览';
    }
    if (route.action === 'todo-summary') {
      return '整理项目待办与失败复盘';
    }
    if (route.action === 'continue-context') {
      return '继续最近项目上下文';
    }
    if (route.action === 'token-factory') {
      return '推进 token 工厂流水线';
    }
    return '文员办公类任务';
  }

  if (route.agent === 'ops-agent') {
    return '服务器运维操作';
  }

  if (route.agent === 'ui-test-agent') {
    return '执行 UI 自动化测试';
  }

  if (route.agent === 'doc-agent') {
    return '查看项目文档或进度说明';
  }

  if (route.agent === 'memory-agent') {
    return '查看或写入项目记忆';
  }

  if (route.agent === 'browser-agent') {
    if (route.action === 'protocol-assets-report') {
      return '协议资产线索定位';
    }
    if (route.action === 'protocol-assets-to-tests') {
      return '协议资产转测试用例';
    }
    return '浏览器/CDP 页面定位';
  }

  return '自然语言请求';
}

function extractFirstUrl(text = '') {
  const match = String(text || '').match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : '';
}

function isBrowserProtocolRequest(route = {}, text = '') {
  return route.agent === 'browser-agent'
    || /(浏览器|页面|网页|cdp|har|协议|接口|network|console|控制台|截图|验证码|登录页|注册页|登录流程|注册流程|抓包|抓一下|打开\s*https?:\/\/|https?:\/\/)/i.test(String(text || ''));
}

function buildBrowserClueCard(text = '', route = {}) {
  const rawText = String(text || '');
  const targetUrl = String(route.url || extractFirstUrl(rawText) || '').trim();
  const signals = [];
  const lower = rawText.toLowerCase();

  if (/截图|snapshot|screenshot/.test(rawText)) signals.push('截图');
  if (/console|控制台|日志/.test(rawText)) signals.push('console');
  if (/接口|抓包|network|har|协议|请求|响应|cdp/.test(rawText)) signals.push('接口/抓包');
  if (/登录|注册|验证码|auth|login|register/.test(lower)) signals.push('登录/注册');

  let status = 'ok';
  let reasonCode = 'ok';
  let reasonText = '已识别到浏览器/CDP 线索，可以继续定位。';
  let nextStep = '先打开目标页面，再看截图、console、network/CDP 和协议资产。';
  let missing = [];
  let executionMode = '浏览器/CDP 分析';

  if (['browser-dry-run', 'browser-live-run', 'protocol-capture-plan'].includes(String(route.action || '')) && !targetUrl && !route.targetUrl) {
    status = 'clarify';
    reasonCode = 'missing_target_url';
    reasonText = /ctf/i.test(rawText)
      ? '我识别到这是 CTF/靶场类页面，但缺少目标 URL，所以还不能直接定位。'
      : '我识别到你在做页面定位，但缺少目标 URL，所以还不能直接定位。';
    nextStep = /ctf/i.test(rawText)
      ? '请直接给我 CTF 靶场地址，比如：https://ctf.example.edu/login'
      : '请直接给我目标地址，比如：https://shop.evanshine.me/login';
    missing = ['targetUrl'];
  } else if (route.action === 'protocol-assets-report') {
    executionMode = '协议资产检索';
    status = 'ok';
    reasonCode = 'protocol_asset_query';
    reasonText = '我识别到你在查协议资产线索，会按方法、路径、状态码和最近样本给你看。';
    nextStep = '如果你要进一步定位页面问题，可以直接说“真实执行 + URL + 抓接口”。';
  } else if (route.action === 'protocol-assets-to-tests') {
    executionMode = '协议资产转测试用例';
    status = 'ok';
    reasonCode = 'protocol_asset_to_tests';
    reasonText = '我识别到你要把协议资产转成测试用例。';
    nextStep = '我会先按方法、路径、状态码和来源资产生成测试用例。';
  } else if (route.action === 'browser-live-run') {
    executionMode = '真实浏览器/CDP 执行';
    status = 'ok';
    reasonCode = 'live_browser_run';
    reasonText = '我识别到你要真实执行浏览器/CDP 页面检查。';
    nextStep = '我会先打开目标页面，再采集截图、console 和接口。';
  } else if (route.action === 'protocol-capture-plan') {
    executionMode = 'dry-run 抓包计划';
    status = 'ok';
    reasonCode = 'protocol_capture_plan';
    reasonText = '我识别到你要做协议抓包和页面定位。';
    nextStep = '我会先给出可执行步骤，再把 console、network/CDP 和截图写进协议资产。';
  }

  return {
    targetUrl,
    executionMode,
    status,
    reasonCode,
    reasonText,
    nextStep,
    matchedSignals: signals,
    evidence: {
      urlPresent: Boolean(targetUrl),
      urlHost: targetUrl ? (() => {
        try {
          return new URL(targetUrl).hostname;
        } catch {
          return '';
        }
      })() : '',
      signalCount: signals.length,
    },
    missing,
  };
}

function buildOpsClarifyExamples(route = {}) {
  if (route.action === 'restart' || route.action === 'peer-restart') {
    return ['重启你自己', '重启 Hermes', '重启 OpenClaw'];
  }
  if (route.action === 'repair' || route.action === 'peer-repair') {
    return ['修复你自己', '修复 Hermes', '修复 OpenClaw'];
  }
  return ['你现在内存多少', '看看 Hermes 的服务器状态', '修复 OpenClaw'];
}

function buildIntentDiagnosis(text = '', route = {}) {
  const intentLabel = inferIntentLabel(route);
  const diagnosis = {
    outcome: 'proceed',
    route,
    confidence: route.confidence || 'high',
    reason: '',
    missing: [],
    intentLabel,
    canExecute: true,
    nextStep: '',
    blockedBy: [],
  };

  if (route.action === 'daily-email-invalid-recipient') {
    diagnosis.outcome = 'reject';
    diagnosis.canExecute = false;
    diagnosis.reason = `我理解你想发送今日日报到邮箱，但收件邮箱格式不对，所以这次没有执行发送。`;
    diagnosis.missing = ['recipientEmail'];
    diagnosis.blockedBy = ['invalid_recipient'];
    diagnosis.nextStep = `请改成完整地址，比如：文员，把今日日报发到 1693457391@qq.com`;
    return diagnosis;
  }

  if (route.agent === 'clerk-agent' && route.action === 'daily-report') {
    diagnosis.outcome = 'clarify';
    diagnosis.canExecute = false;
    diagnosis.reason = '我先按预览理解，这一步只整理日报内容，不直接发送邮箱。';
    diagnosis.blockedBy = ['preview_only'];
    diagnosis.nextStep = '如果你是想直接外发，请说：文员，发送今天日报到邮箱';
    return diagnosis;
  }

  if (route.agent === 'ops-agent' && route.action === 'clarify') {
    diagnosis.outcome = 'clarify';
    diagnosis.canExecute = false;
    diagnosis.reason = '我还不能确定你要做什么运维操作，或者要看哪台服务器，所以这次先不执行，避免误操作。';
    diagnosis.missing = ['action', 'target'];
    diagnosis.blockedBy = ['low_confidence'];
    diagnosis.nextStep = buildOpsClarifyExamples(route).join(' / ');
    return diagnosis;
  }

  if (route.agent === 'ops-agent' && ['restart', 'repair', 'peer-restart', 'peer-repair'].includes(String(route.action || '')) && route.confidence && route.confidence !== 'high') {
    const actionText = String(route.action || '').includes('repair') ? '修复' : '重启';
    const targetText = route.target === 'hermes'
      ? 'Hermes'
      : route.target === 'openclaw'
        ? 'OpenClaw'
        : '我自己';
    diagnosis.outcome = 'clarify';
    diagnosis.canExecute = false;
    diagnosis.reason = `我理解你大概率是想让我${actionText}${targetText}，但这是危险操作，当前表述还没到直接执行的确认门槛。`;
    diagnosis.missing = ['confirmation'];
    diagnosis.blockedBy = ['dangerous_op', 'policy_confirmation_required'];
    diagnosis.nextStep = buildOpsClarifyExamples(route).join(' / ');
    return diagnosis;
  }

  if (route.agent === 'ui-test-agent' && route.action === 'run') {
    diagnosis.outcome = 'handoff';
    diagnosis.reason = '这个请求需要交给 UI 自动化执行链路处理。';
    diagnosis.nextStep = '我会继续走 UI 自动化执行流程。';
    return diagnosis;
  }

  if (route.agent === 'clerk-agent' && route.action === 'daily-email') {
    diagnosis.reason = '我识别到你明确要发送今日日报到邮箱，这次会按发送流程处理。';
    diagnosis.nextStep = route.recipientEmail
      ? `会优先发到 ${route.recipientEmail}，并保留内部归档。`
      : '如果你要指定收件人，可以直接说：文员，把今日日报发到 xxx@qq.com';
    return diagnosis;
  }

  if (route.agent === 'clerk-agent' && route.action === 'todo-summary') {
    diagnosis.reason = '我识别到你在问今天/昨天的任务和失败情况，会先整理待办与失败复盘视角。';
    diagnosis.nextStep = '我会先给出已完成、未完成和失败项清单，再建议下一步优先级。';
    return diagnosis;
  }

  if (route.agent === 'clerk-agent' && route.action === 'continue-context') {
    diagnosis.reason = '我识别到你要沿着最近上下文继续，会先看任务中枢、失败复盘和趋势雷达，而不是重新给通用菜单。';
    diagnosis.nextStep = '我会按任务中枢优先级、失败项和趋势雷达给出下一条可执行动作。';
    return diagnosis;
  }

  if (route.agent === 'clerk-agent' && route.action === 'token-factory') {
    diagnosis.reason = '我识别到你要继续推进 token 工厂，会按生成、评测、归档的流水线继续。';
    diagnosis.nextStep = '我会延续昨天未完成部分，并在结束后回报进度与产出。';
    return diagnosis;
  }

  if (isBrowserProtocolRequest(route, text)) {
    const clueCard = buildBrowserClueCard(text, route);
    diagnosis.clueCard = clueCard;
    diagnosis.intentLabel = clueCard.status === 'clarify'
      ? '浏览器/CDP 页面定位'
      : diagnosis.intentLabel;

    if (clueCard.status === 'clarify') {
      diagnosis.outcome = 'clarify';
      diagnosis.canExecute = false;
      diagnosis.reason = clueCard.reasonText;
      diagnosis.missing = clueCard.missing;
      diagnosis.blockedBy = ['missing_target_url'];
      diagnosis.nextStep = clueCard.nextStep;
      return diagnosis;
    }

    diagnosis.reason = clueCard.reasonText;
    diagnosis.nextStep = clueCard.nextStep;
    return diagnosis;
  }

  if (route.agent === 'planner-agent' && route.action === 'clarify') {
    diagnosis.outcome = 'clarify';
    diagnosis.canExecute = false;
    diagnosis.reason = '我理解你在做总控级安排，但范围较大，先拆成可执行子任务再推进更稳。';
    diagnosis.missing = ['scope', 'priority'];
    diagnosis.blockedBy = ['broad_request'];
    diagnosis.nextStep = '可以先确认优先级：先做 UI 自动化 / 新闻摘要 / token 训练中的哪一项，或给出今天的 P0。';
    return diagnosis;
  }

  diagnosis.reason = '我已经识别到你的意图，可以继续处理。';
  diagnosis.nextStep = '';
  return diagnosis;
}

module.exports = {
  buildIntentDiagnosis,
};
