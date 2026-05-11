'use strict';

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');
const os = require('os');
const pty = require('node-pty');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const WORKSPACE_DIR = path.join(__dirname, 'webpage-ai-work');
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// WebSocket Server for PTY
const wss = new WebSocket.Server({ server, path: '/pty' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const shellType = url.searchParams.get('shell') || 'powershell';
  
  let shell = 'powershell.exe';
  if (os.platform() !== 'win32') {
    shell = 'bash';
  } else {
    if (shellType === 'cmd') shell = 'cmd.exe';
    else if (shellType === 'bash') shell = 'bash.exe';
  }

  let ptyCwd = process.cwd();
  const cwdParam = url.searchParams.get('cwd');
  if (cwdParam) {
    const targetPath = path.join(WORKSPACE_DIR, cwdParam);
    if (fs.existsSync(targetPath)) {
      ptyCwd = targetPath;
    }
  }

  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: ptyCwd,
      env: process.env
    });

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ws.on('message', (msg) => {
      ptyProcess.write(msg);
    });

    ws.on('close', () => {
      try {
        ptyProcess.kill();
      } catch (e) {}
    });
  } catch (err) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\nFailed to start shell: ${err.message}\r\n`);
      ws.close();
    }
  }
});

// Trust proxy headers (important for Cloudflare tunnel)
app.set('trust proxy', 1);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/preview', express.static(WORKSPACE_DIR));

// Dynamic Proxy for high-end projects (e.g. Next.js, Vite)
app.use('/proxy/:port', (req, res, next) => {
  const port = req.params.port;
  if (!port || isNaN(port)) return next();
  createProxyMiddleware({
    target: `http://127.0.0.1:${port}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: { [`^/proxy/${port}`]: '' },
    onError: (err, req, res) => {
      res.status(502).send(`Proxy Error: Dev server on port ${port} might not be running. Start it in the terminal first.`);
    }
  })(req, res, next);
});

// File System APIs
app.get('/api/projects', (req, res) => {
  try {
    const items = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true });
    const projects = items.filter(i => i.isDirectory()).map(i => i.name);
    res.json({ projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/new', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const p = path.join(WORKSPACE_DIR, name);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    res.json({ success: true, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function getAllFiles(dirPath, arrayOfFiles = [], baseDir = '') {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles, baseDir);
    } else {
      const fullPath = path.join(dirPath, file);
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      arrayOfFiles.push(relPath);
    }
  });
  return arrayOfFiles;
}

app.get('/api/files', (req, res) => {
  const { project } = req.query;
  if (!project) return res.status(400).json({ error: 'Project required' });
  const projDir = path.join(WORKSPACE_DIR, project);
  if (!fs.existsSync(projDir)) return res.json({ files: {} });
  
  try {
    const fileList = getAllFiles(projDir, [], projDir);
    const files = {};
    for (const file of fileList) {
      files[file] = fs.readFileSync(path.join(projDir, file), 'utf8');
    }
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/save', (req, res) => {
  const { project, files } = req.body || {};
  if (!project || !files || typeof files !== 'object') return res.status(400).json({ error: 'Invalid input' });
  
  const projDir = path.join(WORKSPACE_DIR, project);
  try {
    if (!fs.existsSync(projDir)) fs.mkdirSync(projDir, { recursive: true });
    for (const [filepath, content] of Object.entries(files)) {
      const fullPath = path.join(projDir, filepath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content || '', 'utf8');
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/delete', (req, res) => {
  const { project, filepath } = req.body || {};
  if (!project || !filepath) return res.status(400).json({ error: 'Invalid input' });
  
  const targetPath = path.join(WORKSPACE_DIR, project, filepath);
  try {
    if (fs.existsSync(targetPath)) {
      if (fs.statSync(targetPath).isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Token Management - Optimized for OpenRouter Free Accounts
const TOKEN_LIMITS = {
  auto: {
    free: 2000,
    gemini: 3000,
    flash: 2000,
    nim: 4000,
    default: 4000
  },
  fast: {
    free: 1000,
    gemini: 1500,
    flash: 1000,
    nim: 2000,
    default: 2000
  },
  balanced: {
    free: 2500,
    gemini: 3500,
    flash: 2500,
    nim: 6000,
    default: 6000
  },
  planning: {
    free: 4000,
    gemini: 8000,
    flash: 4000,
    nim: 12000,
    default: 12000
  }
};

function detectModelTier(model) {
  const m = (model || '').toLowerCase();
  if (m.includes(':free') || m.includes('/free')) return 'free';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('flash')) return 'flash';
  if (m.includes('nim')) return 'nim';
  return 'default';
}

function getTokenLimit(mode, model, manualValue = null) {
  const m = (model || '').toLowerCase();
  
  if (mode === 'manual') {
    const val = parseInt(manualValue, 10);
    if (isNaN(val) || val < 100) return 100;
    if (val > 32000) return 32000;
    return val;
  }
  
  const limits = TOKEN_LIMITS[mode] || TOKEN_LIMITS.auto;
  const tier = detectModelTier(m);
  return limits[tier] || limits.default;
}

function getRecommendations(model) {
  const m = (model || '').toLowerCase();
  const tier = detectModelTier(m);
  
  const recs = {
    free: { min: 500, max: 4000, rec: 2000 },
    gemini: { min: 500, max: 16000, rec: 3000 },
    flash: { min: 500, max: 6000, rec: 2000 },
    nim: { min: 1000, max: 32000, rec: 6000 },
    default: { min: 1000, max: 32000, rec: 6000 }
  };
  
  return recs[tier] || recs.default;
}

// Auto mode tier detection for UI
function getAutoTierInfo(model) {
  const tier = detectModelTier(model);
  const tierNames = {
    free: 'Free Model',
    gemini: 'Gemini',
    flash: 'Flash',
    nim: 'NVIDIA NIM',
    default: 'Standard'
  };
  return {
    tier,
    tierName: tierNames[tier],
    autoTokens: TOKEN_LIMITS.auto[tier] || TOKEN_LIMITS.auto.default
  };
}

const SYSTEM_PROMPT = `You are an expert developer. Generate complete working code. Respond ONLY with valid JSON: {"files":{"filename.ext":"content"}}`;

const FALLBACK_FILES = {
  'index.html': '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Generated Project</title><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#eee}</style></head><body><h1>Generated Project</h1></body></html>',
  'style.css': 'body{font-family:system-ui;padding:20px;background:#1a1a2e;color:#eee}',
  'script.js': 'console.log("WebForge AI Generated");'
};

// Extract JSON from response
function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  text = text.trim();
  text = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) {}
  }
  try { return JSON.parse(text); } catch (_) {}
  return null;
}

function makeFallback() {
  return FALLBACK_FILES;
}

// Routes
app.get('/models', async (req, res) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.json({ models: [] });
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const data = await r.json();
    const models = (data.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      isFree: m.pricing && parseFloat(m.pricing.prompt) === 0
    })).sort((a, b) => a.id.localeCompare(b.id));
    res.json({ models });
  } catch (e) {
    res.json({ models: [] });
  }
});

app.get('/credits', (req, res) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.json({ usage: 0, limit: null });
  fetch('https://openrouter.ai/api/v1/auth/key', {
    headers: { 'Authorization': `Bearer ${key}` }
  }).then(r => r.json()).then(data => {
    res.json({ usage: data.data?.usage || 0, limit: data.data?.limit || null });
  }).catch(() => res.json({ usage: 0, limit: null }));
});

app.get('/nim-models', async (req, res) => {
  const nimKey = process.env.NVIDIA_API_KEY;
  const fallbackModels = [
    { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct' },
    { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct' },
    { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B' },
    { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B' },
    { id: 'mistralai/mistral-7b-instruct-v0.3', name: 'Mistral 7B Instruct' },
    { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B' },
    { id: 'deepseek-ai/deepseek-v3', name: 'DeepSeek V3' },
    { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1' }
  ];
  
  if (!nimKey) return res.json({ models: fallbackModels });
  
  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
      headers: { 'Authorization': `Bearer ${nimKey}` }
    });
    if (!r.ok) return res.json({ models: fallbackModels });
    const data = await r.json();
    if (data && data.data && data.data.length > 0) {
      const models = data.data.map(m => ({
        id: m.id,
        name: m.id
      })).sort((a, b) => a.name.localeCompare(b.name));
      res.json({ models });
    } else {
      res.json({ models: fallbackModels });
    }
  } catch (e) {
    res.json({ models: fallbackModels });
  }
});

app.get('/recommendations', (req, res) => {
  const model = req.query.model || '';
  const recs = getRecommendations(model);
  const tierInfo = getAutoTierInfo(model);
  res.json({ ...recs, ...tierInfo });
});

app.post('/generate', async (req, res) => {
  const { prompt, model, provider, tokenMode, manualTokens, project } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' });
  if (!model?.trim()) return res.status(400).json({ error: 'Model required' });

  const orKey = process.env.OPENROUTER_API_KEY;
  const gmKey = process.env.GEMINI_API_KEY;
  const nimKey = process.env.NVIDIA_API_KEY;

  if (provider === 'gemini' && !gmKey) return res.status(500).json({ error: 'No Gemini key' });
  if (provider === 'nim' && !nimKey) return res.status(500).json({ error: 'No NVIDIA API key' });
  if (provider !== 'gemini' && provider !== 'nim' && !orKey) return res.status(500).json({ error: 'No OpenRouter key' });

  const maxTokens = (provider === 'nim' || provider === 'opencode')
    ? 32000
    : getTokenLimit(tokenMode || 'auto', model, manualTokens);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt + '\n\nOutput ONLY JSON.' }
  ];

  const doGenerate = async (tokens, retryCount = 0) => {
    try {
      let raw;
      if (provider === 'gemini') {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gmKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt + '\n\nOutput ONLY JSON.' }] }], generationConfig: { maxOutputTokens: tokens } })
        });

        if (r.status === 402) {
          const newTokens = Math.max(500, Math.floor(tokens * 0.5));
          if (retryCount < 2 && newTokens >= 500) {
            return doGenerate(newTokens, retryCount + 1);
          }
          throw new Error('Insufficient Gemini credits. Please add more credits.');
        }

        const d = await r.json();
        raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else if (provider === 'nim') {
        const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${nimKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: tokens })
        });

        if (r.status === 402 || r.status === 429) {
          const newTokens = Math.max(500, Math.floor(tokens * 0.5));
          if (retryCount < 2 && newTokens >= 500) {
            return doGenerate(newTokens, retryCount + 1);
          }
          throw new Error('Insufficient NVIDIA NIM credits or rate limit. Please check your NVIDIA API quota.');
        }

        const d = await r.json();
        if (d.error) throw new Error(d.error.message || 'NVIDIA NIM API Error');
        raw = d.choices?.[0]?.message?.content || '';
      } else {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://webforge.ai', 'X-Title': 'WebForge' },
          body: JSON.stringify({ model, messages, max_tokens: tokens })
        });

        if (r.status === 402) {
          const newTokens = Math.max(500, Math.floor(tokens * 0.5));
          if (retryCount < 2 && newTokens >= 500) {
            return doGenerate(newTokens, retryCount + 1);
          }
          throw new Error('Insufficient credits. Please add more credits to your OpenRouter account.');
        }

        const d = await r.json();
        if (d.error) throw new Error(d.error.message || 'API Error');
        raw = d.choices?.[0]?.message?.content || '';
      }

      let parsed = extractJSON(raw);
      if (!parsed?.files) {
        const retryPrompt = 'Return ONLY JSON: {"files":{"index.html":"<html>","style.css":"","script.js":""}}';
        let retryRaw;

        if (provider === 'gemini') {
          const rr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gmKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: retryPrompt }] }] })
          });
          const rd = await rr.json();
          retryRaw = rd.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (provider === 'nim') {
          const rr = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${nimKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: retryPrompt }], max_tokens: 4000 })
          });
          const rd = await rr.json();
          retryRaw = rd.choices?.[0]?.message?.content || '';
        } else {
          const rr = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: retryPrompt }], max_tokens: 4000 })
          });
          const rd = await rr.json();
          retryRaw = rd.choices?.[0]?.message?.content || '';
        }

        parsed = extractJSON(retryRaw);
      }

      if (!parsed?.files || typeof parsed.files !== 'object') {
        parsed = { files: makeFallback() };
      }

      return { files: parsed.files, tokensUsed: tokens, warning: retryCount > 0 ? `Retry successful with ${tokens} tokens` : null };
    } catch (e) {
      if (retryCount < 2 && e.message.includes('credit')) {
        const newTokens = Math.max(500, Math.floor(tokens * 0.5));
        return doGenerate(newTokens, retryCount + 1);
      }
      throw e;
    }
  };

  try {
    const result = await doGenerate(maxTokens);
    if (project && result.files) {
      const projDir = path.join(WORKSPACE_DIR, project);
      if (!fs.existsSync(projDir)) fs.mkdirSync(projDir, { recursive: true });
      for (const [filepath, content] of Object.entries(result.files)) {
        const fullPath = path.join(projDir, filepath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content || '', 'utf8');
      }
    }
    res.json(result);
  } catch (e) {
    res.json({ files: makeFallback(), warning: e.message });
  }
});

// OpenCode API - Real implementation
app.post('/opencode/chat', async (req, res) => {
  const { apiKey, messages } = req.body || {};
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array required' });
  }
  
  try {
    const response = await fetch('https://opencode.ai/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'opencode/minimax-m2.5-free',
        messages: messages,
        temperature: 0.3,
        max_tokens: 16000
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'OpenCode error' });
    }
    
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(400).json({ error: 'No response from OpenCode' });
    }
    
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/opencode/connect', async (req, res) => {
  const { apiKey } = req.body || {};
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }
  
  // Test the API key with a simple request
  try {
    const response = await fetch('https://opencode.ai/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'opencode/minimax-m2.5-free',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10
      })
    });
    
    if (response.ok) {
      res.json({ success: true, message: 'Connected to OpenCode!' });
    } else {
      const data = await response.json();
      res.status(401).json({ error: data.error?.message || 'Invalid API key' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// OpenCode API - Streaming support
app.post('/opencode/chat/stream', async (req, res) => {
  const { apiKey, messages } = req.body || {};

  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const response = await fetch('https://opencode.ai/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'opencode/minimax-m2.5-free',
        messages: messages,
        temperature: 0.3,
        max_tokens: 16000
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      res.write(`data: ${JSON.stringify({ error: errData.error?.message || 'OpenCode error' })}\n\n`);
      res.end();
      return;
    }

    const data = await response.json();

    if (data.error) {
      res.write(`data: ${JSON.stringify({ error: data.error.message || 'OpenCode error' })}\n\n`);
      res.end();
      return;
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      res.write(`data: ${JSON.stringify({ error: 'No response from OpenCode' })}\n\n`);
      res.end();
      return;
    }

    // Stream the content in chunks
    const chunkSize = 50;
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize);
      res.write(`data: ${JSON.stringify({ chunk, done: false })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ chunk: '', done: true })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// OpenCode API - Real implementation
app.post('/opencode/chat', async (req, res) => {
  const { apiKey, messages } = req.body || {};

  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  try {
    const response = await fetch('https://opencode.ai/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'opencode/minimax-m2.5-free',
        messages: messages,
        temperature: 0.3,
        max_tokens: 16000
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'OpenCode error' });
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(400).json({ error: 'No response from OpenCode' });
    }

    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/opencode/connect', async (req, res) => {
  const { apiKey } = req.body || {};

  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  // Test the API key with a simple request
  try {
    const response = await fetch('https://opencode.ai/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'opencode/minimax-m2.5-free',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10
      })
    });

    if (response.ok) {
      res.json({ success: true, message: 'Connected to OpenCode!' });
    } else {
      const data = await response.json();
      res.status(401).json({ error: data.error?.message || 'Invalid API key' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Shell command execution with streaming support
app.post('/terminal', (req, res) => {
  const { cmd, stream } = req.body || {};
  if (!cmd) return res.json({ output: '' });

  if (cmd.trim() === 'clear') return res.json({ type: 'clear' });
  if (cmd.trim() === 'help') return res.json({
    output: `WebForge Terminal v1.0

Available Commands:
  opencode     - Launch OpenCode AI assistant
  /connect <key> - Connect to OpenCode
  clear        - Clear terminal screen
  help         - Show this help message
  exit         - Close terminal

Shell Commands:
  Any standard shell command (ls, cd, cat, node, npm, etc.)`

  });

  if (cmd.trim() === 'opencode') {
    return res.json({ type: 'opencode', message: 'OpenCode mode activated! Use /connect <your-api-key> to authenticate.' });
  }

  if (cmd.trim() === 'exit') {
    return res.json({ type: 'exit' });
  }

  const isNpmOrNode = /\b(npm|node|npx)\b/.test(cmd);

  try {
    const child = spawn(cmd, [], {
      shell: true,
      timeout: isNpmOrNode ? 60000 : 15000,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    let output = '';
    let errorOutput = '';
    let sentFirstOutput = false;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
    }

    child.stdout?.on('data', d => {
      const text = d.toString();
      output += text;
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'stdout', data: text, done: false })}\n\n`);
        sentFirstOutput = true;
      }
    });

    child.stderr?.on('data', d => {
      const text = d.toString();
      errorOutput += text;
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'stderr', data: text, done: false })}\n\n`);
        sentFirstOutput = true;
      }
    });

    child.on('close', code => {
      const finalOutput = output + (errorOutput ? '\n' + errorOutput : '') || `Exit code: ${code}`;
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'done', data: '', exitCode: code, done: true })}\n\n`);
        res.end();
      } else {
        res.json({ output: finalOutput, exitCode: code });
      }
    });

    child.on('error', e => {
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'error', data: e.message, done: true })}\n\n`);
        res.end();
      } else {
        res.json({ error: e.message });
      }
    });

    if (stream) {
      setTimeout(() => {
        if (!sentFirstOutput) {
          res.write(`data: ${JSON.stringify({ type: 'stdout', data: '', done: false })}\n\n`);
        }
      }, 100);
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'error', data: '\n[Timed out after ' + (isNpmOrNode ? 60 : 15) + ' seconds]', done: true })}\n\n`);
        res.end();
      }
    }, isNpmOrNode ? 65000 : 20000);

    child.on('close', () => clearTimeout(timer));

  } catch (e) {
    res.json({ error: e.message });
  }
});



// Download
app.post('/download', (req, res) => {
  const { files } = req.body || {};
  if (!files || typeof files !== 'object') return res.status(400).json({ error: 'No files' });

  const parts = [];
  const entries = Object.entries(files);
  let offset = 0;
  const cdEntries = [];

  for (const [name, content] of entries) {
    const n = Buffer.from(name);
    const d = Buffer.from(content || '');
    
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(d.length, 18);
    header.writeUInt32LE(d.length, 22);
    header.writeUInt16LE(n.length, 26);
    header.writeUInt16LE(0, 28);
    
    parts.push(header, n, d);
    cdEntries.push({ name: n, data: d, offset });
    offset += 30 + n.length + d.length;
  }

  const cd = [];
  for (const e of cdEntries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0, 12);
    h.writeUInt16LE(0, 14);
    h.writeUInt32LE(0, 16);
    h.writeUInt32LE(e.data.length, 20);
    h.writeUInt32LE(e.data.length, 24);
    h.writeUInt16LE(e.name.length, 28);
    h.writeUInt16LE(0, 30);
    h.writeUInt16LE(0, 32);
    h.writeUInt16LE(0, 34);
    h.writeUInt16LE(0, 36);
    h.writeUInt32LE(0, 38);
    h.writeUInt32LE(e.offset, 42);
    cd.push(h, e.name);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.reduce((s, b) => s + b.length, 0), 12);
  eocd.writeUInt32LE(offset, 16);

  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="project.zip"' });
  res.send(Buffer.concat([...parts, ...cd, eocd]));
});

server.listen(PORT, HOST, () => {
  console.log(`WebForge AI starting...`);
  console.log(`Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});