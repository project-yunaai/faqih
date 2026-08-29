const statusEl = document.getElementById('status');
const statusIcon = document.getElementById('statusIcon');
const statusTitle = document.getElementById('statusTitle');
const statusDesc = document.getElementById('statusDesc');
const captureBtn = document.getElementById('captureBtn');
const openGeminiBtn = document.getElementById('openGeminiBtn');
const tokensPanel = document.getElementById('tokensPanel');
const sendProxyBtn = document.getElementById('sendProxyBtn');
const supabaseStatus = document.getElementById('supabaseStatus');
const proxyStatus = document.getElementById('proxyStatus');
const captureTime = document.getElementById('captureTime');

function setStatus(type, title, desc, icon) {
  statusEl.className = `status status-${type}`;
  statusTitle.textContent = title;
  statusDesc.textContent = desc;
  statusIcon.textContent = icon || '';
}

function displayTokens(data) {
  if (!data) return;

  tokensPanel.classList.remove('hidden');

  document.getElementById('token-at').textContent = data.at || '-';
  document.getElementById('token-fsid').textContent = data.fSid || '-';
  document.getElementById('token-bl').textContent = data.bl || '-';
  document.getElementById('token-shareid').textContent = data.shareId || '-';
  document.getElementById('token-cookies').textContent = data.cookies
    ? `${data.cookieCount || '?'} cookies · ${data.cookies.substring(0, 100)}...`
    : '-';

  proxyStatus.textContent = data.sentToProxy ? '✓ Terkirim' : '✗ Belum';
  proxyStatus.style.color = data.sentToProxy ? '#34A853' : '#EA4335';

  supabaseStatus.textContent = data.supabaseSaved ? '✓ Tersimpan' : '✗ Belum';
  supabaseStatus.style.color = data.supabaseSaved ? '#34A853' : '#EA4335';

  if (data.timestamp) {
    const date = new Date(data.timestamp);
    captureTime.textContent = date.toLocaleTimeString('id-ID');
  }

  // Show capture reason if TTS intercept
  if (data.captureReason && data.captureReason.includes('tts')) {
    setStatus('success', 'Token via TTS!', 'Token di-update dari TTS request', '🎙️');
  }
}

async function findGeminiTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].url && tabs[0].url.includes('gemini.google.com')) {
    return tabs[0].id;
  }
  const geminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (geminiTabs[0]) {
    return geminiTabs[0].id;
  }
  return null;
}

function updateStatus() {
  chrome.storage.local.get('capturedData', (result) => {
    const data = result.capturedData;
    if (data && data.at) {
      displayTokens(data);
      setStatus('success', 'Token Tersedia', 'Klik Capture untuk refresh', '✅');
    } else if (data) {
      displayTokens(data);
      setStatus('error', 'Token tidak ditemukan', 'Klik Capture untuk coba lagi', '⚠️');
    } else {
      setStatus('idle', 'Menunggu', 'Buka Gemini lalu klik Capture', '⏳');
    }
  });
}

updateStatus();

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  setStatus('loading', 'Capturing...', 'Mencari tab Gemini...', '🔄');

  try {
    const tabId = await findGeminiTab();

    if (!tabId) {
      setStatus('error', 'Tab Gemini tidak ditemukan', 'Buka halaman Gemini lalu klik lagi', '❌');
      captureBtn.disabled = false;
      return;
    }

    setStatus('loading', 'Capturing...', `Tab #${tabId} - Inject content script...`, '🔄');

    // Try to inject content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    } catch (e) {
      // Already injected or not allowed, continue
    }

    setStatus('loading', 'Capturing...', `Tab #${tabId} - Extracting tokens...`, '🔄');

    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_NOW',
      tabId,
    });

    if (response && response.success && response.data) {
      displayTokens(response.data);
      if (response.data.at) {
        setStatus('success', 'Berhasil!', 'Tokens & cookies ter-capture', '✅');
      } else {
        setStatus('error', 'Token tidak ditemukan', 'Login ke Gemini & refresh halaman', '❌');
      }
    } else {
      setStatus('error', 'Gagal capture', response?.error || 'Unknown error', '❌');
    }
  } catch (e) {
    setStatus('error', 'Error', e.message, '❌');
  }

  captureBtn.disabled = false;
});

openGeminiBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://gemini.google.com/share/6b9cf06b4c9b' });
});

sendProxyBtn.addEventListener('click', async () => {
  sendProxyBtn.disabled = true;
  sendProxyBtn.textContent = 'Mengirim...';

  try {
    const result = await chrome.storage.local.get('capturedData');
    if (!result.capturedData) {
      alert('Belum ada data. Capture dulu!');
      sendProxyBtn.disabled = false;
      sendProxyBtn.textContent = 'Kirim ke Pro Image Studio';
      return;
    }

    const response = await fetch('https://yuna.kertasdigital.id/api/gemini/capture-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...result.capturedData, key: 'yuna-rahasia-2026' }),
    });

    if (response.ok) {
      sendProxyBtn.textContent = '✓ Terkirim!';
      proxyStatus.textContent = '✓ Terkirim';
      proxyStatus.style.color = '#34A853';
      setStatus('success', 'Terkirim!', 'Token sudah dikirim ke yuna.kertasdigital.id', '✅');
    } else {
      sendProxyBtn.textContent = 'Gagal - Coba lagi';
      proxyStatus.textContent = '✗ Error';
      proxyStatus.style.color = '#EA4335';
    }
  } catch (e) {
    sendProxyBtn.textContent = 'Gagal - Coba lagi';
    setStatus('error', 'Server tidak aktif', 'Cek koneksi ke yuna.kertasdigital.id', '❌');
  }

  setTimeout(() => {
    sendProxyBtn.disabled = false;
    sendProxyBtn.textContent = 'Kirim ke Pro Image Studio';
  }, 2000);
});

document.querySelectorAll('.btn-copy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-target');
    const el = document.getElementById(target);
    const text = el.textContent;

    if (text === '-' || !text) return;

    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 1500);
    });
  });
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.capturedData) {
    updateStatus();
  }
});
