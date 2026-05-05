function inferIntentLabel(route = {}) {
  if (route.agent === 'clerk-agent') {
    if (route.action === 'daily-email' || route.action === 'daily-email-invalid-recipient') {
      return '发送今日日报到邮箱';
    }
    if (route.action === 'daily-report') {
      return '查看日报预览';
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

  return '自然语言请求';
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
    diagnosis.reason = '我还不能确定你要做什么运维操作，或者要看哪台服务器，所以这次先没执行。';
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

  diagnosis.reason = '我已经识别到你的意图，可以继续处理。';
  diagnosis.nextStep = '';
  return diagnosis;
}

module.exports = {
  buildIntentDiagnosis,
};
