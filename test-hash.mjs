import crypto from 'crypto'
const sapisid='WXLtBVwIxEXvkJbL/AH_ugy5pWMNQ8gTK9'
const t='1787388279338'
const origin='https://gemini.google.com'
const str=`${t} ${sapisid} ${origin}`
console.log('sha1 hex', crypto.createHash('sha1').update(str).digest('hex'))
console.log('sha1 b64', crypto.createHash('sha1').update(str).digest('base64'))
console.log('sha1 b64url', crypto.createHash('sha1').update(str).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''))
console.log('expected ADR5zapbfc67QVv_bgDw4F-GBnZ5')
