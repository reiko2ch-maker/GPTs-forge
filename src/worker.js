const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API = (apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
const MAX_PHASE_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 85000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOW_ORIGIN = '*';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/api/forge') {
      return handleForge(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleForge(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Method Not Allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'リクエストJSONを解析できませんでした。' }, 400);
  }

  const phaseId = String(body?.phaseId || '').trim();
  const ctx = String(body?.ctx || '').trim();
  const currentData = body?.currentData && typeof body.currentData === 'object' ? body.currentData : {};
  const apiKey = String(body?.apiKey || env.GEMINI_API_KEY || '').trim();

  if (!phaseId) return json({ ok: false, message: 'phaseId がありません。' }, 400);
  if (!ctx) return json({ ok: false, message: '入力コンテキストが空です。' }, 400);
  if (!apiKey) {
    return json({ ok: false, message: 'Gemini APIキーがありません。Cloudflare Workerの秘密鍵 GEMINI_API_KEY を設定するか、画面から直接入力してください。' }, 400);
  }

  try {
    const payload = buildPhasePayload(ctx, phaseId, currentData);
    const data = await callGeminiJson(apiKey, payload, phaseId);
    return json({ ok: true, phaseId, data }, 200);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = error?.message || 'Worker側で生成に失敗しました。';
    return json({ ok: false, phaseId, message }, status);
  }
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  return Math.round((1400 * Math.pow(2, attempt)) + (Math.random() * 900));
}

function summarizeText(value, limit = 600) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function summarizePrior(data = {}) {
  const parts = [];
  if (data.docTitle) parts.push(`【現在の設計書タイトル】${summarizeText(data.docTitle, 120)}`);
  if (data.analysis) parts.push(`【既存の分析要約】${summarizeText(data.analysis, 500)}`);
  if (Array.isArray(data.names) && data.names.length) parts.push(`【既存の名前候補】${data.names.map(x => summarizeText(x.title, 60)).join(' / ')}`);
  if (Array.isArray(data.promptBlocks) && data.promptBlocks.length) parts.push(`【既に生成済みのプロンプト】${data.promptBlocks.map(x => summarizeText(x.title, 60)).join(' / ')}`);
  if (Array.isArray(data.knowledgeFiles) && data.knowledgeFiles.length) parts.push(`【既に生成済みの知識ファイル】${data.knowledgeFiles.map(x => summarizeText(x.title, 60)).join(' / ')}`);
  if (Array.isArray(data.manualFiles) && data.manualFiles.length) parts.push(`【既に生成済みのマニュアル】${data.manualFiles.map(x => summarizeText(x.title, 60)).join(' / ')}`);
  return parts.join('\n');
}

function buildPhasePayload(ctx, phaseId, currentData = {}) {
  const prior = summarizePrior(currentData);
  const shared = `あなたは「高単価でも通用するGPTs設計」を担当する主席AIシステムアーキテクト兼デジタル商品戦略家です。\n以下の入力に完全特化し、必ずJSONだけを返してください。前置き・補足・コードフェンスは禁止です。\n\n${ctx}${prior ? `\n\n${prior}` : ''}\n\n共通ルール:\n- すべて日本語\n- 抽象論・一般論は禁止\n- 販売・実装・運用ですぐ使える完成度\n- 自然な日本語。AI臭い定型文は禁止\n- 高単価商品として見せても弱くならない濃さで書く\n- JSON以外は返さない`;

  const prompts = {
    overview: `${shared}\n\n今回は設計書タイトルと分析だけを出力してください。\n返却JSON例:\n{"docTitle":"...","analysis":"..."}`,
    names: `${shared}\n\n今回はGPTs名の候補だけを出力してください。3案に固定。\n返却JSON例:\n{"names":[{"title":"名前案A","content":"名前の意図・世界観・売れる理由"},{"title":"名前案B","content":"..."},{"title":"名前案C","content":"..."}]}`,
    icons: `${shared}\n\n今回はアイコン案だけを出力してください。3案に固定。各案に title, content, iconJapanesePrompt, iconEnglishPrompt を含めてください。\n返却JSON例:\n{"icons":[{"title":"案A","content":"世界観・色・訴求意図","iconJapanesePrompt":"...","iconEnglishPrompt":"..."}]}`,
    prompt_create: `${shared}\n\n今回は promptBlocks の1本目だけを出力してください。GPTs作成画面にそのまま貼りやすい「コピペ専用の作成項目一覧」です。\n返却JSON例:\n{"promptBlocks":[{"title":"コピペ専用の作成項目一覧","content":"..."}]}`,
    prompt_system: `${shared}\n\n今回は promptBlocks の2本目だけを出力してください。本番運用レベルの高性能システムプロンプトです。役割・目的・入力整理・必須ワークフロー・知識ファイル利用規則・出力ルール・品質チェック・不足情報時の動き・禁止事項・セルフレビューまで含めてください。\n返却JSON例:\n{"promptBlocks":[{"title":"本番運用レベルの高性能システムプロンプト","content":"..."}]}`,
    prompt_chat: `${shared}\n\n今回は promptBlocks の3本目だけを出力してください。初回ヒアリング設計、会話スターター、出力精度を上げる質問テンプレを含めてください。\n返却JSON例:\n{"promptBlocks":[{"title":"初回ヒアリング設計と会話スターター","content":"..."}]}`,
    knowledge_core: `${shared}\n\n今回は knowledgeFiles のうち2本だけを出力してください。どちらもそのまま知識ファイルとして投入できる本文にしてください。\n返却JSON例:\n{"knowledgeFiles":[{"title":"知識ファイル1","fileName":"knowledge_1","content":"..."},{"title":"知識ファイル2","fileName":"knowledge_2","content":"..."}]}`,
    knowledge_bonus: `${shared}\n\n今回は knowledgeFiles の追加1本だけを出力してください。既存ファイルと内容が被らない補完ファイルにしてください。\n返却JSON例:\n{"knowledgeFiles":[{"title":"補完知識ファイル","fileName":"knowledge_bonus","content":"..."}]}`,
    manual_user: `${shared}\n\n今回は購入者向け活用マニュアルを1本だけ出力してください。\n返却JSON例:\n{"manualFiles":[{"title":"購入者向け活用マニュアル","fileName":"user_manual","content":"..."}]}`,
    manual_seller: `${shared}\n\n今回は販売者向けの高単価化マニュアルを1本だけ出力してください。\n返却JSON例:\n{"manualFiles":[{"title":"販売者向け高単価化マニュアル","fileName":"seller_manual","content":"..."}]}`,
    sales: `${shared}\n\n今回はマネタイズ設計・販売文・訴求軸だけを出力してください。copyAngles と titleIdeas は各5件以上にしてください。\n返却JSON例:\n{"monetize":"...","copyAngles":["..."],"titleIdeas":["..."],"productDescription":"...","benefits":["..."],"fitFor":"...","notFitFor":"...","ctaSoft":"...","ctaStrong":"...","trustPhrases":["..."]}`,
  };

  const maxTokens = {
    overview: 1800,
    names: 1400,
    icons: 1900,
    prompt_create: 1800,
    prompt_system: 4200,
    prompt_chat: 1800,
    knowledge_core: 3300,
    knowledge_bonus: 1800,
    manual_user: 3200,
    manual_seller: 3200,
    sales: 3000,
  };

  const temperature = {
    overview: 0.45,
    names: 0.68,
    icons: 0.64,
    prompt_create: 0.42,
    prompt_system: 0.38,
    prompt_chat: 0.46,
    knowledge_core: 0.44,
    knowledge_bonus: 0.44,
    manual_user: 0.44,
    manual_seller: 0.44,
    sales: 0.56,
  };

  return {
    contents: [{ parts: [{ text: prompts[phaseId] || prompts.sales }] }],
    generationConfig: {
      temperature: temperature[phaseId] ?? 0.5,
      topP: 0.9,
      maxOutputTokens: maxTokens[phaseId] ?? 2200,
    },
  };
}

function sanitizeJsonText(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractLikelyJson(text) {
  const cleaned = sanitizeJsonText(text);
  if (!cleaned) return '';
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function parseGeminiEnvelope(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Geminiの応答全体を解析できませんでした。');
  }

  const candidate = raw?.candidates?.[0];
  const finishReason = String(candidate?.finishReason || '').toUpperCase();
  const joined = (raw.candidates || [])
    .flatMap((c) => c.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!joined) throw new Error('Geminiから有効な出力が返りませんでした。');
  if (finishReason && finishReason !== 'STOP') {
    if (finishReason === 'MAX_TOKENS') throw new Error('Geminiの出力が途中で切れました。');
    if (finishReason === 'SAFETY') throw new Error('Geminiの安全フィルタにより出力が止まりました。入力内容を少し調整してください。');
  }

  const jsonText = extractLikelyJson(joined);
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('GeminiのJSON出力が壊れています。');
  }
}

async function callGeminiJson(apiKey, payload, phaseId) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_PHASE_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resp = await fetch(GEMINI_API(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await resp.text();

      if (!resp.ok) {
        let message = text;
        try {
          const parsed = JSON.parse(text);
          message = parsed?.error?.message || text;
        } catch {}

        const err = new Error(mapGeminiError(resp.status, message));
        err.status = resp.status;
        if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_PHASE_ATTEMPTS - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }

      try {
        return parseGeminiEnvelope(text);
      } catch (parseErr) {
        lastError = parseErr;
        if (attempt < MAX_PHASE_ATTEMPTS - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw parseErr;
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        lastError = new Error(`Geminiの応答がタイムアウトしました（phase: ${phaseId}）。`);
      } else if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error(`Gemini呼び出しに失敗しました（phase: ${phaseId}）。`);
      }

      if (attempt < MAX_PHASE_ATTEMPTS - 1 && (RETRYABLE_STATUS.has(lastError.status || 0) || /タイムアウト|不安定|JSON|有効な出力/.test(lastError.message))) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Gemini呼び出しに失敗しました。');
}

function mapGeminiError(status, message) {
  const msg = String(message || '').toLowerCase();
  if (status === 400 && (msg.includes('api key not valid') || msg.includes('api_key_invalid'))) {
    return 'Gemini APIキーが無効です。Cloudflare Workerの秘密鍵または入力したキーを確認してください。';
  }
  if (status === 400 && (msg.includes('quota') || msg.includes('resource exhausted'))) {
    return 'Geminiの利用上限に達しています。少し待つか、課金・利用状況を確認してください。';
  }
  if (status === 403) return 'Gemini APIへのアクセスが拒否されました。';
  if (status === 429) return 'Geminiのリクエスト上限に達しました。';
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'Gemini側または生成処理が一時的に不安定です。';
  return message || `HTTP ${status}`;
}
