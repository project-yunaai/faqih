// Background service worker v2.0
// Handle cookie capture, storage, kirim ke proxy, auto-save ke Supabase
// Auto-refresh cookies setiap 2 menit, intercept TTS requests

const PROXY_URL = 'http://localhost:3010/api/gemini/capture-tokens';
const API_KEY = 'yuna-rahasia-2026';

const SUPABASE_URL = 'https://rgzjrrqlbvvnzoiwjjku.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnempycnFsYnZ2bnpvaXdqamt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MzI2NTcsImV4cCI6MjA4NjEwODY1N30.kx2Ye3HHQ8GI3hkjLfcpHVArz_kRB72f5p1WB7k0Nho';

// All cookie names needed for Gemini
const COOKIE_NAMES = [
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
  '__Secure-1PAPISID', '__Secure-3PAPISID',
  'SIDCC',
  '__Secure-1PSID', '__Secure-3PSID',
  '__Secure-1PSIDTS', '__Secure-3PSIDTS',
  '__Secure-1PSIDCC', '__Secure-3PSIDCC',
  'LSID', '__Secure-ENID', 'NID',
  'ACCOUNT_CHOOSER', 'GAPS',
];

// ===== COOKIE CAPTURE (improved) =====
async function getCookiesForGemini() {
  const cookies = {};

  // Method 1: chrome.cookies.getAll for each domain (more reliable than get)
  const domains = [
    'gemini.google.com',
    '.google.com',
    '.google.co.id',
    'accounts.google.com',
  ];

  for (const domain of domains) {
    try {
      const allCookies = await chrome.cookies.getAll({ domain });
      for (const c of allCookies) {
        if (COOKIE_NAMES.includes(c.name) && !cookies[c.name]) {
          cookies[c.name] = c.value;
        }
      }
    } catch {}
  }

  // Method 2: Also try by URL for secure cookies
  const urls = [
    'https://gemini.google.com',
    'https://www.google.com',
    'https://accounts.google.com',
  ];

  for (const url of urls) {
    for (const name of COOKIE_NAMES) {
      if (!cookies[name]) {
        try {
          const cookie = await chrome.cookies.get({ url, name });
          if (cookie && cookie.value) {
            cookies[name] = cookie.value;
          }
        } catch {}
      }
    }
  }

  return cookies;
}

function buildCookieString(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ===== SUPABASE =====
async function saveToSupabase(data) {
  const payload = {
    at: data.at || null,
    bl: data.bl || null,
    f_sid: data.fSid || null,
    share_id: data.shareId || null,
    hl: data.hl || 'id',
    cookies: data.cookies || null,
    url: data.url || '',
    captured_by: 'extension-v2',
    is_active: true,
  };

  // Deactivate old
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/gemini_tokens?is_active=eq.true`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ is_active: false }),
    });
  } catch {}

  // Insert new
  const response = await fetch(`${SUPABASE_URL}/rest/v1/gemini_tokens`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Supabase error: ${response.status} ${errText}`);
  }

  const result = await response.json();
  return result[0];
}

// ===== TOKEN EXTRACTION =====
async function extractFromTab(tabId) {
  // Try content script first
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TOKENS_FROM_CONTENT' });
    if (response && response.success && response.tokens) {
      return response.tokens;
    }
  } catch {}

  // Fallback: inject extraction script
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const tokens = { at: null, bl: null, fSid: null, shareId: null, hl: null, url: window.location.href };

        // Strategy 1: Script tags
        const allText = Array.from(document.querySelectorAll('script'))
          .map(s => s.textContent || '').join('\n') + '\n' + document.documentElement.outerHTML;

        const patterns = {
          at: [/"SNlM0e"\s*:\s*"([^"]+)"/, /'SNlM0e'\s*:\s*'([^']+)'/],
          bl: [/"cfb2h"\s*:\s*"([^"]+)"/, /'cfb2h'\s*:\s*'([^']+)'/],
          fSid: [/"FdrFJe"\s*:\s*"([^"]+)"/, /'FdrFje'\s*:\s*'([^']+)'/],
          hl: [/"hl"\s*:\s*"([a-z]{2}(?:-[A-Z]{2})?)"/, /'hl'\s*:\s*'([a-z]{2}(?:-[A-Z]{2})?)'/],
        };

        for (const [key, regexList] of Object.entries(patterns)) {
          for (const regex of regexList) {
            const m = allText.match(regex);
            if (m && m[1]) { tokens[key] = m[1]; break; }
          }
        }

        // Strategy 2: WIZ_global_data
        try {
          if (window.WIZ_global_data) {
            if (!tokens.at && window.WIZ_global_data.SNlM0e) tokens.at = window.WIZ_global_data.SNlM0e;
            if (!tokens.bl && window.WIZ_global_data.cfb2h) tokens.bl = window.WIZ_global_data.cfb2h;
            if (!tokens.fSid && window.WIZ_global_data.FdrFJe) tokens.fSid = window.WIZ_global_data.FdrFJe;
          }
        } catch {}

        // Strategy 3: window globals
        try {
          if (!tokens.at && typeof window.SNlM0e !== 'undefined') tokens.at = window.SNlM0e;
          if (!tokens.bl && typeof window.cfb2h !== 'undefined') tokens.bl = window.cfb2h;
          if (!tokens.fSid && typeof window.FdrFJe !== 'undefined') tokens.fSid = window.FdrFJe;
        } catch {}

        // Extract share ID from URL
        const m = window.location.pathname.match(/\/share\/([a-f0-9]+)/i);
        if (m) tokens.shareId = m[1];

        return tokens;
      },
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch {}

  return null;
}

async function findGeminiTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].url && tabs[0].url.includes('gemini.google.com')) {
    return tabs[0].id;
  }
  const geminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (geminiTabs[0]) return geminiTabs[0].id;
  return null;
}

// ===== SAVE FULL DATA =====
async function saveFullData(fullData) {
  await chrome.storage.local.set({ capturedData: fullData, lastTokens: fullData });

  // Save to Supabase
  try {
    const record = await saveToSupabase(fullData);
    fullData.supabaseId = record?.id;
    fullData.supabaseSaved = true;
  } catch (e) {
    fullData.supabaseSaved = false;
    fullData.supabaseError = e.message;
  }

  // Send to proxy
  try {
    const resp = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fullData, key: API_KEY }),
    });
    fullData.sentToProxy = resp.ok;
    if (!resp.ok) fullData.proxyError = `HTTP ${resp.status}`;
  } catch (e) {
    fullData.sentToProxy = false;
    fullData.proxyError = e.message;
  }

  await chrome.storage.local.set({ capturedData: fullData });
  return fullData;
}

// ===== CAPTURE ALL =====
async function captureAll(tabId) {
  let tokens = null;

  if (!tabId) tabId = await findGeminiTab();
  if (tabId) tokens = await extractFromTab(tabId);

  if (!tokens || (!tokens.at && !tokens.bl)) {
    const stored = await chrome.storage.local.get('lastTokens');
    if (stored.lastTokens) tokens = { ...(tokens || {}), ...stored.lastTokens };
  }

  if (!tokens) tokens = { at: null, bl: null, fSid: null, shareId: null, hl: null, url: '' };

  const cookieObj = await getCookiesForGemini();
  const cookieString = buildCookieString(cookieObj);

  const fullData = {
    ...tokens,
    cookies: cookieString,
    cookiesParsed: cookieObj,
    cookieCount: Object.keys(cookieObj).length,
    timestamp: Date.now(),
  };

  return await saveFullData(fullData);
}

// ===== AUTO-REFRESH COOKIES EVERY 2 MINUTES =====
// __Secure-1PSIDTS expires in ~4 hours, refresh every 2 min to keep fresh
chrome.alarms.create('refresh-cookies', { periodInMinutes: 2 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh-cookies') {
    // Re-capture cookies only (don't need to re-extract tokens)
    getCookiesForGemini().then(async (cookieObj) => {
      const cookieString = buildCookieString(cookieObj);
      const stored = await chrome.storage.local.get('capturedData');
      if (stored.capturedData && stored.capturedData.at) {
        const updated = { ...stored.capturedData, cookies: cookieString, cookiesParsed: cookieObj, cookieCount: Object.keys(cookieObj).length, timestamp: Date.now() };
        await chrome.storage.local.set({ capturedData: updated });

        // Send updated cookies to proxy
        try {
          await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...updated, key: API_KEY }),
          });
          console.log('[Auto-refresh] Cookies updated');
        } catch {}

        // Also update Supabase
        try {
          await saveToSupabase(updated);
        } catch {}
      }
    });
  }
});

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_NOW') {
    captureAll(msg.tabId)
      .then(data => sendResponse({ success: true, data }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'TOKENS_FOUND') {
    getCookiesForGemini().then(cookieObj => {
      const cookieString = buildCookieString(cookieObj);
      const fullData = {
        ...msg.tokens,
        cookies: cookieString,
        cookiesParsed: cookieObj,
        cookieCount: Object.keys(cookieObj).length,
        timestamp: Date.now(),
        captureReason: msg.reason || 'auto',
      };
      saveFullData(fullData);
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ===== ON INSTALLED =====
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Extension] v2.0 installed. Auto-refresh cookies every 2 min.');
});
