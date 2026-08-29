import crypto from 'crypto'
const candidates = [
  'WXLtBVwIxEXvkJbL/AH_ugy5pWMNQ8gTK9',
  'qMx-I6tQCWlT3lsB/AovbZEFjtDWhuKZ8E',
  'A64lLkKVTAN-3oC0_',
  'A8mj1AdO4yVUKfRsq',
]
const t='1787388279338'
for(const s of candidates){
  const h=crypto.createHash('sha1').update(`${t} ${s} https://gemini.google.com`).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  console.log(s.substring(0,10), h)
}
