import crypto from 'crypto'
import fs from 'fs'
const raw=JSON.parse(fs.readFileSync('D:\\Yuna\\Rupaai Clone\\gemini\\gemini-cookies.json','utf8').replace(/^\uFEFF/,''))
const t='1787388279338'
const expected='ADR5zapbfc67QVv_bgDw4F-GBnZ5'
for(const c of raw.cookies){
  for(const algo of ['sha1','sha256']){
    for(const origin of ['https://gemini.google.com','https://gemini.google.com:443','']){
      const str = origin ? `${t} ${c.value} ${origin}` : `${t} ${c.value}`
      const h=crypto.createHash(algo).update(str).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
      if(h===expected || h.startsWith(expected.substring(0,8))){
        console.log('MATCH', c.name, algo, origin, h)
      }
    }
  }
}
console.log('done, expected', expected)
