import axios from 'axios'
import { chromium } from 'playwright'

const PROFILE = 'C:\\Users\\ASUS\\OneDrive\\Documents\\Default Project\\.chrome-profile'
const SHARE_URL = 'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6'

const browser = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: true })
const page = await browser.newPage()
let at = ''
let bl = '', fSid = '', sourcePath = ''
page.on('request', (req) => {
  if (req.url().includes('batchexecute')) {
    const u = new URL(req.url())
    const m = req.postData()?.match(/&at=([^&]+)/)?.[1] || ''
    if (u.searchParams.get('bl') && u.searchParams.get('f.sid') && m) {
      at = decodeURIComponent(m)
      bl = u.searchParams.get('bl')
      fSid = u.searchParams.get('f.sid')
      sourcePath = u.searchParams.get('source-path') || '/share/b1493cbc4a17'
    }
  }
})
await page.goto(SHARE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(9000)

const cookies = await browser.cookies('https://gemini.google.com')
const cookieHeader = cookies.map((c) => c.name + '=' + c.value).join('; ')
console.log('COOKIES_COUNT', cookies.length, 'AT', at.slice(0, 20), 'fSid', fSid)

const prompt = 'a small red cat sitting on a blue chair'
const inner = JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
})
const fReqInner = '[null,"' + inner.replace(/"/g, '\\"') + '",4,"b1493cbc4a17"]'
const fReq = JSON.stringify([['q4uTj', fReqInner, null, 'generic']])
const body = 'f.req=' + encodeURIComponent(fReq) + '&at=' + encodeURIComponent(at)

const url =
  'https://gemini.google.com/_/BardChatUi/data/batchexecute' +
  '?rpcids=q4uTj&source-path=' + encodeURIComponent(sourcePath) +
  '&bl=' + encodeURIComponent(bl) + '&f.sid=' + encodeURIComponent(fSid) +
  '&hl=id&_reqid=12345&rt=c'

try {
  const resp = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Cookie: cookieHeader,
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com' + sourcePath,
      'X-Same-Domain': '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    timeout: 120000,
    validateStatus: () => true,
    responseType: 'text',
  })
  const raw = String(resp.data)
  console.log('UPSTREAM_STATUS', resp.status, 'LEN', raw.length)
  const m = raw.match(/\/9j\/[A-Za-z0-9+\/=]{500,}/)
  console.log('IMAGE_FOUND', !!m, m ? 'len=' + m[0].length : '')
  if (!m) console.log('BODY_HEAD', raw.substring(0, 300))
} catch (e) {
  console.log('AXIOS_ERR', e.message)
}

// Also try in-browser fetch (same session) as comparison
try {
  const result = await page.evaluate(
    async ({ url, body, at }) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
        body,
      })
      const t = await r.text()
      const m = t.match(/\/9j\/[A-Za-z0-9+/=]{500,}/)
      return { status: r.status, len: t.length, image: !!m, head: t.substring(0, 200) }
    },
    { url, body, at }
  )
  console.log('IN_BROWSER', JSON.stringify(result))
} catch (e) {
  console.log('IN_BROWSER_ERR', e.message)
}

await browser.close()
