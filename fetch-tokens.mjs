import fs from 'fs'
import axios from 'axios'
const raw = JSON.parse(fs.readFileSync('D:\\Yuna\\Rupaai Clone\\gemini\\gemini-cookies.json','utf8').replace(/^\uFEFF/,''))
const header = raw.cookies.map(c=> `${c.name}=${c.value}`).join('; ')
const url = 'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6'
axios.get(url, { headers: { Cookie: header, 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'} }).then(r=>{
  const t=r.data
  console.log('len',t.length)
  const at = t.match(/"at":"([^"]+)"/)
  console.log('at', at?.[1]?.substring(0,60))
  const sid = t.match(/"f\.sid":"([^"]+)"/) || t.match(/f\.sid[^0-9]*([0-9-]+)/)
  console.log('sid', sid?.[1]?.substring(0,40))
  const bl = t.match(/"bl":"([^"]+)"/) || t.match(/bl[^"]*"([^"]+)"/)
  console.log('bl', bl?.[1]?.substring(0,60))
  fs.writeFileSync('page-head.html', t.substring(0,8000))
  console.log('saved')
}).catch(e=> console.log('err', e.message, e.response?.status, String(e.response?.data).substring(0,300)))
