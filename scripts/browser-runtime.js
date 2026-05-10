'use strict';

const EXTERNAL_ECOMMERCE_HOST_PATTERNS = [
  /(^|\.)jd\.com$/i,
  /(^|\.)360buy\.com$/i,
  /(^|\.)yangkeduo\.com$/i,
  /(^|\.)pinduoduo\.com$/i,
  /(^|\.)taobao\.com$/i,
  /(^|\.)tmall\.com$/i,
  /(^|\.)1688\.com$/i,
  /(^|\.)amazon\./i,
  /(^|\.)ebay\./i,
];

function normalizeBrowserRuntimeAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'observe' || normalized === 'browser-observe') return 'observe';
  if (normalized === 'act' || normalized === 'browser-act') return 'act';
  if (normalized === 'extract' || normalized === 'browser-extract') return 'extract';
  return normalized || 'observe';
}

function buildBrowserRuntimeDryRun(input = {}) {
  const operation = normalizeBrowserRuntimeAction(input.action || input.operation);
  const instruction = normalizeText(input.instruction || input.prompt || input.rawText);
  const targetUrl = normalizeTargetUrl(input.targetUrl || input.url || extractFirstUrl(instruction));
  const actionText = normalizeText(input.actionText || input.command || input.instruction);
  const schemaFields = normalizeSchemaFields(input.schema || input.fields);

  const validation = validateBrowserRuntimeInput({ operation, targetUrl, actionText });
  if (!validation.allowed) {
    return buildBlockedResult({
      operation,
      targetUrl,
      instruction,
      schemaFields,
      reason: validation.reason,
    });
  }

  const safety = evaluateBrowserRuntimeTargetSafety(targetUrl);
  if (!safety.allowed) {
    return buildBlockedResult({
      operation,
      targetUrl,
      instruction,
      schemaFields,
      reason: safety.reason,
    });
  }

  const steps = buildOperationSteps({ operation, targetUrl, instruction, actionText, schemaFields });
  return {
    mode: 'dry-run',
    runtime: 'browser-runtime',
    operation,
    blocked: false,
    allowed: true,
    reason: null,
    plan: {
      targetUrl,
      instruction,
      actionText: operation === 'act' ? actionText : '',
      schemaFields,
      safety: {
        allowed: true,
        scope: safety.scope,
      },
    },
    steps,
    artifacts: {
      browserLaunched: false,
      expectedOutputs: buildExpectedOutputs(operation),
    },
    summary: `Prepared browser ${operation} dry-run plan with ${steps.length} step(s).`,
  };
}

function validateBrowserRuntimeInput({ operation, targetUrl, actionText }) {
  if (!['observe', 'act', 'extract'].includes(operation)) {
    return {
      allowed: false,
      reason: `Unsupported browser runtime action: ${operation}`,
    };
  }
  if (operation === 'act' && !targetUrl) {
    return {
      allowed: false,
      reason: 'browser-act requires targetUrl before an action can be planned.',
    };
  }
  if (operation === 'act' && !actionText) {
    return {
      allowed: false,
      reason: 'browser-act requires action text before an action can be planned.',
    };
  }
  return { allowed: true, reason: null };
}

function buildOperationSteps({ operation, targetUrl, instruction, actionText, schemaFields }) {
  const steps = [];
  if (targetUrl) {
    steps.push({
      type: 'navigate',
      detail: 'Open the allowlisted target page.',
      targetUrl,
    });
  }

  if (operation === 'observe') {
    steps.push(
      {
        type: 'observe_dom',
        detail: instruction || 'Read visible text, headings, forms, controls, and page state.',
      },
      {
        type: 'summarize_interactive_elements',
        detail: 'Return stable candidates for follow-up actions without clicking anything.',
      },
    );
    return steps;
  }

  if (operation === 'act') {
    steps.push(
      {
        type: 'observe_before_action',
        detail: 'Locate the safest matching element before execution.',
      },
      {
        type: 'perform_action',
        detail: actionText,
      },
      {
        type: 'observe_after_action',
        detail: 'Capture resulting page state, URL, errors, and visible confirmation.',
      },
    );
    return steps;
  }

  steps.push(
    {
      type: 'observe_dom',
      detail: instruction || 'Read page content before extraction.',
    },
    {
      type: 'extract_schema',
      detail: schemaFields.length
        ? `Extract fields: ${schemaFields.join(', ')}`
        : 'Extract structured fields inferred from the page and instruction.',
      schemaFields,
    },
    {
      type: 'validate_extraction',
      detail: 'Return missing fields and confidence notes instead of inventing data.',
    },
  );
  return steps;
}

function buildBlockedResult({ operation, targetUrl, instruction, schemaFields, reason }) {
  return {
    mode: 'dry-run',
    runtime: 'browser-runtime',
    operation,
    blocked: true,
    allowed: false,
    reason,
    plan: {
      targetUrl,
      instruction,
      schemaFields,
      safety: {
        allowed: false,
        reason,
      },
    },
    steps: [],
    artifacts: {
      browserLaunched: false,
      expectedOutputs: [],
    },
    summary: `Blocked browser ${operation} plan: ${reason}`,
  };
}

function buildExpectedOutputs(operation) {
  if (operation === 'observe') {
    return ['page_summary', 'interactive_elements', 'next_action_candidates'];
  }
  if (operation === 'act') {
    return ['action_plan', 'post_action_state', 'verification_notes'];
  }
  if (operation === 'extract') {
    return ['structured_data', 'missing_fields', 'confidence_notes'];
  }
  return [];
}

function evaluateBrowserRuntimeTargetSafety(url) {
  if (!url) {
    return {
      allowed: true,
      scope: 'no-target-dry-run',
      reason: null,
    };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return {
      allowed: false,
      scope: 'invalid',
      reason: 'Blocked: targetUrl is invalid and cannot be safely planned.',
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      allowed: false,
      scope: 'invalid-protocol',
      reason: 'Blocked: only http/https targetUrl values are allowed.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (EXTERNAL_ECOMMERCE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return {
      allowed: false,
      scope: 'external-ecommerce',
      reason: 'Blocked: external ecommerce targets are outside the self-owned allowlist.',
    };
  }

  if (isLoopbackHost(hostname)) {
    return { allowed: true, scope: 'localhost', reason: null };
  }
  if (hostname === 'evanshine.me' || hostname.endsWith('.evanshine.me')) {
    return { allowed: true, scope: 'self-owned-evanshine', reason: null };
  }
  if (hostname === 'projectku.local' || hostname === 'projectku.com' || hostname.endsWith('.projectku.com')) {
    return { allowed: true, scope: 'self-owned-projectku', reason: null };
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.test')) {
    return { allowed: true, scope: 'local-test', reason: null };
  }

  return {
    allowed: false,
    scope: 'not-allowlisted',
    reason: 'Blocked: targetUrl is outside the localhost/self-owned/projectku/evanshine allowlist.',
  };
}

function normalizeSchemaFields(schema) {
  if (!schema) return [];
  if (Array.isArray(schema)) {
    return schema.map((field) => normalizeFieldName(field)).filter(Boolean);
  }
  if (typeof schema === 'object') {
    if (Array.isArray(schema.fields)) {
      return schema.fields.map((field) => normalizeFieldName(field)).filter(Boolean);
    }
    if (schema.fields && typeof schema.fields === 'object') {
      return Object.keys(schema.fields).map((field) => normalizeFieldName(field)).filter(Boolean);
    }
    return Object.keys(schema).map((field) => normalizeFieldName(field)).filter(Boolean);
  }
  return String(schema)
    .split(/[,，\s]+/)
    .map((field) => normalizeFieldName(field))
    .filter(Boolean);
}

function normalizeFieldName(field) {
  if (typeof field === 'string') return field.trim();
  if (field && typeof field === 'object') return String(field.name || field.key || '').trim();
  return '';
}

function normalizeTargetUrl(value) {
  const text = normalizeText(value);
  return text || '';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function extractFirstUrl(text = '') {
  const match = String(text || '').match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : '';
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

module.exports = {
  buildBrowserRuntimeDryRun,
  evaluateBrowserRuntimeTargetSafety,
  normalizeBrowserRuntimeAction,
  normalizeSchemaFields,
};
