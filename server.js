/**
 * JARVIS Web OS — Backend
 * Express server + GLM integration via OpenAI-compatible API
 */
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // ضروري ليعمل على Render

/* ══════════════════════════════════════════════════
   إعدادات GLM — تُقرأ من متغيرات البيئة على Render
   ══════════════════════════════════════════════════ */
const CONFIG = {
  GLM_API_KEY : process.env.GLM_API_KEY  || '',
  GLM_BASE_URL: process.env.GLM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  GLM_MODEL   : process.env.GLM_MODEL    || 'z-ai/glm-5.3',
};

const KEY_READY = CONFIG.GLM_API_KEY.length > 0;

// لا نعتبر وجود المفتاح وحده دليلاً على نجاح الاتصال.
// تتحول الحالة إلى ready فقط بعد أول استجابة ناجحة من المزود.
const glmState = {
  status   : KEY_READY ? 'configured' : 'missing-key',
  lastError: null,
  checkedAt: null,
};

function providerError(err) {
  const status = Number(err?.status) || null;
  const code   = err?.code || err?.error?.code || null;
  const raw    = String(err?.message || 'Unknown provider error');

  let hint = 'Check provider status and request configuration.';
  if (status === 401) hint = 'Authentication failed: verify that the API key belongs to the configured provider.';
  else if (status === 403) hint = 'The key is valid but does not have access to this model or endpoint.';
  else if (status === 404) hint = 'Model or endpoint not found: verify GLM_MODEL and GLM_BASE_URL.';
  else if (status === 429) hint = 'Rate limit or quota exceeded: check credits and request limits.';
  else if (status && status >= 500) hint = 'The upstream AI provider returned a server error.';

  return {
    status,
    code,
    message: raw.slice(0, 500),
    hint,
  };
}

function markGlmReady() {
  glmState.status = 'ready';
  glmState.lastError = null;
  glmState.checkedAt = new Date().toISOString();
}

function markGlmError(err) {
  glmState.status = 'error';
  glmState.lastError = providerError(err);
  glmState.checkedAt = new Date().toISOString();
  return glmState.lastError;
}

const glm = new OpenAI({
  apiKey : CONFIG.GLM_API_KEY || 'missing',
  baseURL: CONFIG.GLM_BASE_URL,
});
const SYSTEM_PROMPT = `You are JARVIS, the command intelligence of a futuristic web OS.
Tone: precise, calm, slightly futuristic. Never break character.

Formatting rules:
- Use Markdown. Short paragraphs. Bullet lists when enumerating.
- Bold key terms. Keep answers tight unless asked for depth.
- When asked to discover tools, return a compact list: name — one-line value.
- When asked to draft LinkedIn content, write a ready-to-publish post under 1300 chars:
  a scroll-stopping hook on line 1, 3 short value bullets, one question CTA, then 3-5 hashtags.`;
const logClients = new Set();

function log(level, source, message) {
  const entry = { ts: Date.now(), level, source, message };
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of logClients) {
    try { res.write(payload); } catch { logClients.delete(res); }
  }
  console.log(`[${source}] ${message}`);
}
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
/* ─── فحص الصحة (يستخدمه UptimeRobot لمنع النوم) ─── */
app.get('/api/health', (_req, res) => {
  res.json({
    status   : 'ok',
    core     : 'online',
    glm      : glmState.status,
    model    : CONFIG.GLM_MODEL,
    baseUrl  : CONFIG.GLM_BASE_URL,
    checkedAt: glmState.checkedAt,
    lastError: glmState.lastError,
    timestamp: new Date().toISOString(),
  });
});

/* ─── بث السجلات المباشر ─── */
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  logClients.add(res);
  res.write(`data: ${JSON.stringify({
    ts: Date.now(), level: 'info', source: 'CORE', message: 'Log stream attached.'
  })}\n\n`);

  req.on('close', () => logClients.delete(res));
});
app.post('/api/jarvis/chat', async (req, res) => {
  const message = (req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const t0 = Date.now();

  log('info', 'AGENT', `Command: "${message.slice(0, 70)}"`);

  if (!KEY_READY) {
    send({ type: 'error', message: 'GLM API key is not configured.' });
    log('error', 'GLM', 'Missing API key.');
    return res.end();
  }

  try {
    const stream = await glm.chat.completions.create({
      model      : CONFIG.GLM_MODEL,
      stream     : true,
      temperature: 0.7,
      messages   : [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: message },
      ],
    });

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        send({ type: 'delta', content: delta });
      }
    }

    const ms = Date.now() - t0;
    markGlmReady();
    send({ type: 'done', ms });
    log('success', 'GLM', `Complete in ${ms}ms · ${full.length} chars`);
    res.end();
  } catch (err) {
    const diag = markGlmError(err);
    console.error('GLM ERROR:', diag);
    log('error', 'GLM', `HTTP ${diag.status || '?'} · ${diag.code || 'unknown'} · ${diag.message}`);
    send({
      type: 'error',
      message: diag.message,
      status : diag.status,
      code   : diag.code,
      hint   : diag.hint,
    });
    res.end();
  }
});
/* ══════════════════════════════════════════════════
   رادار الأدوات (mock — يمكن استبداله بـ RSS لاحقاً)
   ══════════════════════════════════════════════════ */
const TOOL_POOL = [
  { name:'NexusFlow',   category:'Agent Orchestration',   features:'Visual multi-agent graph builder with memory', audience:'AI engineers',       impact:9.2, price:'Free tier' },
  { name:'LumenDoc',    category:'Document Intelligence', features:'PDF → structured JSON with schema validation', audience:'Ops, legal, finance', impact:8.6, price:'Freemium' },
  { name:'VoxCraft',    category:'Voice & Audio',         features:'Real-time voice cloning, 40 languages',       audience:'Podcasters, studios', impact:8.9, price:'Free 10 min/mo' },
  { name:'PixelForge',  category:'Generative Imaging',    features:'Text-to-UI that exports to React + Tailwind', audience:'Designers, devs',     impact:9.0, price:'Free tier' },
  { name:'SentinelML',  category:'AI Security',           features:'Prompt-injection detection + PII redaction',  audience:'Security teams',      impact:8.4, price:'Open source' },
  { name:'QueryMint',   category:'Data & Analytics',      features:'Natural language → SQL with lineage',         audience:'Analysts, BI',        impact:8.7, price:'Freemium' },
  { name:'SynthRecall', category:'Knowledge / RAG',       features:'Self-hosted hybrid vector + graph search',    audience:'Backend engineers',   impact:8.5, price:'Open source' },
  { name:'FrameShift',  category:'Video Generation',      features:'Script → 60s branded video with captions',    audience:'Marketers',           impact:9.1, price:'Free 5 videos' },
  { name:'CodeAtlas',   category:'Dev Tooling',           features:'Repo-wide Q&A with dependency context',       audience:'Developers',          impact:8.8, price:'Free for OSS' },
  { name:'PulseBoard',  category:'Ops / Monitoring',      features:'LLM observability — traces, cost, evals',     audience:'MLOps teams',         impact:8.3, price:'Free 10k spans' },
];

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

app.get('/api/tools/discover', async (_req, res) => {
  log('info', 'NEWS', 'Google News RSS scan started (mock).');
  await new Promise(r => setTimeout(r, 700));
  const tools = shuffle(TOOL_POOL).slice(0, 4);
  log('success', 'NEWS', `Radar returned ${tools.length} tools.`);
  res.json({
    generatedAt: new Date().toISOString(),
    count: tools.length,
    source: 'mock',
    tools,
  });
});

/* ══════════════════════════════════════════════════
   توليد مسودات LinkedIn عبر GLM
   ══════════════════════════════════════════════════ */
function parseJSON(raw) {
  const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

app.post('/api/linkedin/draft', async (req, res) => {
  const tools = Array.isArray(req.body?.tools) ? req.body.tools : [];
  if (!tools.length) return res.status(400).json({ error: 'tools[] is required' });
  if (!KEY_READY)    return res.status(503).json({ error: 'GLM API key missing' });

  const list = tools.slice(0, 3)
    .map(t => `- ${t.name} (${t.category}): ${t.features}. Audience: ${t.audience}. Impact: ${t.impact}/10`)
    .join('\n');

  log('info', 'AGENT', `Drafting LinkedIn posts for ${tools.length} tool(s)…`);

  try {
    const out = await glm.chat.completions.create({
      model: CONFIG.GLM_MODEL,
      temperature: 0.85,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content:
`Write one LinkedIn post for EACH of the following AI tools:

${list}

Return STRICT JSON only — no prose, no code fences:
{"drafts":[{"tool":"<tool name>","content":"<the post, max 1300 chars>","hashtags":["tag1","tag2","tag3"]}]}` },
      ],
    });

    const parsed = parseJSON(out.choices?.[0]?.message?.content);
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    if (!drafts.length) throw new Error('Model returned no parsable drafts');

    markGlmReady();
    log('success', 'AGENT', `Generated ${drafts.length} draft(s).`);
    res.json({ ok: true, count: drafts.length, drafts });
  } catch (err) {
    const diag = markGlmError(err);
    console.error('GLM DRAFT ERROR:', diag);
    log('error', 'AGENT', `Draft generation failed · HTTP ${diag.status || '?'} · ${diag.message}`);
    res.status(diag.status && diag.status >= 400 && diag.status < 600 ? diag.status : 500).json({
      error : diag.message,
      status: diag.status,
      code  : diag.code,
      hint  : diag.hint,
    });
  }
});

/* ══════════════════════════════════════════════════
   نشر / جدولة LinkedIn (mock حتى تضيف مفاتيح OAuth)
   ══════════════════════════════════════════════════ */
app.post('/api/linkedin/post', async (req, res) => {
  const { content, scheduledAt } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });

  log('warn', 'LINKEDIN', 'Mock mode (no OAuth credentials).');
  await new Promise(r => setTimeout(r, 800));
  log('success', 'LINKEDIN', `Mock dispatch OK · ${content.length} chars`);
  res.json({
    ok: true,
    mock: true,
    id: 'urn:li:share:' + Date.now(),
    scheduledAt: scheduledAt || null,
  });
});

/* ══════════════════════════════════════════════════
   تشغيل الخادم
   ══════════════════════════════════════════════════ */
app.listen(PORT, HOST, () => {
  console.log(`\n  JARVIS Web OS running on http://${HOST}:${PORT}`);
  log('info', 'CORE', `Server online on port ${PORT}.`);
  log(KEY_READY ? 'info' : 'warn', 'GLM',
      KEY_READY
        ? `Configured · ${CONFIG.GLM_MODEL} · awaiting first successful provider response`
        : 'API key missing');
});