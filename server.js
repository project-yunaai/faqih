import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const PORT = 3001
const SHARE_URL = 'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6'
const PROFILE = 'C:\\Users\\ASUS\\OneDrive\\Documents\\Default Project\\.chrome-profile'

let TOKENS = null

function loadCookiesHeader() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'gemini-cookies.json'), 'utf8').replace(/^\uFEFF/,''))
  const list = raw.cookies || raw
  return list.map(c=> `${c.name}=${c.value}`).join('; ')
}

async function refreshTokens() {
  console.log('[TOKENS] Refreshing via Playwright...')
  const { chromium } = await import('playwright')
  const browser = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: true })
  const page = await browser.newPage()
  let captured = null
  page.on('request', req=>{
    if (req.url().includes('batchexecute')) {
      const url = new URL(req.url())
      const rawAt = req.postData()?.match(/&at=([^&]+)/)?.[1] || ''
      const at = rawAt ? decodeURIComponent(rawAt) : ''
      if (url.searchParams.get('bl') && url.searchParams.get('f.sid') && at) {
        captured = {
          bl: url.searchParams.get('bl'),
          fSid: url.searchParams.get('f.sid'),
          hl: url.searchParams.get('hl') || 'id',
          rpcids: 'q4uTj',
          sourcePath: url.searchParams.get('source-path') || '/share/b1493cbc4a17',
          at,
        }
      }
    }
  })
  await page.goto(SHARE_URL, { waitUntil:'domcontentloaded', timeout:60000 })
  await page.waitForTimeout(10000)
  let cookiesHeader = ''
  try {
    const ctxCookies = await browser.cookies('https://gemini.google.com')
    cookiesHeader = ctxCookies.map(c => `${c.name}=${c.value}`).join('; ')
  } catch (e) {
    console.error('[TOKENS] Cookie capture failed:', e.message)
  }
  await browser.close()
  if (!captured || !captured.at) throw new Error('Failed to capture tokens: ' + JSON.stringify(captured))
  captured.cookies = cookiesHeader
  TOKENS = captured
  console.log('[TOKENS] Got', JSON.stringify(TOKENS).substring(0,200))
  return TOKENS
}

async function getTokens() {
  if (TOKENS) return TOKENS
  try { return await refreshTokens() } catch(e){ console.error(e.message); throw e }
}

app.get('/api/health', async (_req,res)=>{
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname,'gemini-cookies.json'),'utf8').replace(/^\uFEFF/,''))
  res.json({ status:'ok', cookies: raw.cookies.length, tokens: TOKENS? 'cached':'none' })
})

app.post('/api/generate', async (req,res)=>{
  try{
    const { prompt, ratio='1:1' } = req.body
    if(!prompt?.trim()) return res.status(400).json({error:'Prompt required'})
    let tokens = await getTokens().catch(()=>null)
    if(!tokens) tokens = { bl:'boq_assistant-bard-web-server_20260821.03_p0', fSid:'5787236648636799226', rpcids:'q4uTj', sourcePath:'/share/b1493cbc4a17', hl:'id', at:'' }
    const cookiesHeader = tokens?.cookies || loadCookiesHeader()

    async function doGenerate(attempt=0){
      const t = attempt===0? tokens : await refreshTokens()
      const reqId = Math.floor(Math.random()*900000+100000)
      const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=${t.rpcids}&source-path=${encodeURIComponent(t.sourcePath)}&bl=${t.bl}&f.sid=${t.fSid}&hl=${t.hl}&_reqid=${reqId}&rt=c`
      const inner = JSON.stringify({ contents:[{role:'user', parts:[{text:prompt}]}], generationConfig:{ responseModalities:['IMAGE'], imageConfig:{aspectRatio:ratio} } })
      const fReqInner = `[null,"${inner.replace(/"/g,'\\"')}",4,"b1493cbc4a17"]`
      const fReq = JSON.stringify([[[t.rpcids, fReqInner, null, 'generic']]])
      const body = `f.req=${encodeURIComponent(fReq)}&at=${t.at}`
      console.log(`[API] POST q4uTj attempt ${attempt+1} reqId ${reqId}`)
      const resp = await axios.post(url, body, {
        headers:{
          'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
          'Cookie': cookiesHeader,
          'Origin':'https://gemini.google.com',
          'Referer':`https://gemini.google.com${t.sourcePath}`,
          'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Same-Domain':'1',
        },
        timeout:180000, maxContentLength:Infinity, maxBodyLength:Infinity, responseType:'text', validateStatus:()=>true
      })
      const raw = String(resp.data)
      console.log(`[API] Status ${resp.status} len ${raw.length}`)
      if(resp.status===401 && attempt===0){
        console.log('[API] 401, refreshing tokens...')
        return doGenerate(1)
      }
      if(resp.status!==200) throw new Error(`Upstream ${resp.status}: ${raw.substring(0,300)}`)
      const m = raw.match(/"data"\s*:\s*"(\/9j\/[^"]{500,})"/) || raw.match(/\/9j\/[A-Za-z0-9+\/=]{500,}/)?.[0] && [null, raw.match(/\/9j\/[A-Za-z0-9+\/=]{500,}/)[0]]
      const b64 = m ? (m[1]||m[0]) : null
      if(!b64) throw new Error('No image in response: '+ raw.substring(0,600))
      return b64
    }

    const b64 = await doGenerate()
    console.log(`[API] Image ${b64.length} chars`)
    res.json({ success:true, data:{ url:`data:image/jpeg;base64,${b64}`, prompt, ratio }})
  }catch(e){
    console.error('[API] Error', e.message)
    res.status(500).json({error:e.message})
  }
})

app.post('/api/image-to-image', (_req,res)=> res.status(422).json({error:'Gunakan Text to image'}))

app.listen(PORT, ()=> console.log(`[SERVER] Direct endpoint on http://localhost:${PORT}`))
