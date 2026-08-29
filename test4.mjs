import crypto from 'crypto'
import fs from 'fs'
const raw=JSON.parse(fs.readFileSync('D:\\Yuna\\Rupaai Clone\\gemini\\gemini-cookies.json','utf8').replace(/^\uFEFF/,''))
const t='1787388279338'
const origin='https://gemini.google.com'
for(const c of raw.cookies){
  const h=crypto.createHash('sha1').update(`${t} ${c.value} ${origin}`).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  if(h.startsWith('ADR5')){
    console.log('MATCH', c.name, h)
  }
}
console.log('done')
