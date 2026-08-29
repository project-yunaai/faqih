import crypto from 'crypto'
const s='WXLtBVwIxEXvkJbL/AH_ugy5pWMNQ8gTK9'
const t='1787388279338'
for(const o of ['https://gemini.google.com','https://gemini.google.com:443','http://gemini.google.com','gemini.google.com','']){
  const str = o ? `${t} ${s} ${o}` : `${t} ${s}`
  const h=crypto.createHash('sha1').update(str).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  console.log(o||'(no origin)', h)
}
