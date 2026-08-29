import { useState } from 'react'
import './App.css'
import { generateImage, generateImageToImage } from './api.js'

const samples = [
  {
    id: 1,
    title: 'Neon solitude',
    prompt: 'A lone astronaut walking through a neon forest at midnight',
    colors: ['#fb81c5', '#5148d6'],
  },
  {
    id: 2,
    title: 'Silent coast',
    prompt: 'A cinematic lighthouse above a quiet misty sea',
    colors: ['#8ac9d3', '#223d57'],
  },
  {
    id: 3,
    title: 'Desert bloom',
    prompt: 'A glass greenhouse blooming in the middle of a desert',
    colors: ['#f5b76c', '#8d5269'],
  },
]

const Icon = ({ name }) => {
  const paths = {
    sparkles: 'M12 3l1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9L12 3ZM5 15l.7 2.3L8 18.5l-2.3 1.2L5 22l-.7-2.3L2 18.5l2.3-1.2L5 15Zm13-2 .9 3.1L22 17.5l-3.1 1.4L18 22l-.9-3.1-3.1-1.4 3.1-1.4L18 13Z',
    image: 'M4 4h16v16H4V4Zm2 2v10l4-4 3 3 2-2 3 3V6H6Zm3 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    upload: 'M12 3l5 5h-3v6h-4V8H7l5-5Zm-7 13h4v2h6v-2h4v5H5v-5Z',
    download: 'M10 3h4v7h3l-5 5-5-5h3V3ZM5 18h14v3H5v-3Z',
    plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
    close: 'm6 6 12 12M18 6 6 18',
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} fill={name === 'close' ? 'none' : 'currentColor'} stroke={name === 'close' ? 'currentColor' : 'none'} strokeWidth="2" />
    </svg>
  )
}

function App() {
  const [mode, setMode] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [style, setStyle] = useState('Cinematic')
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [sourceImage, setSourceImage] = useState(null)
  const [sourcePreview, setSourcePreview] = useState(null)

  const handleFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('File harus berupa gambar')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      alert('Ukuran maksimal 8MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSourceImage(reader.result)
      setSourcePreview(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const generate = async () => {
    if (!prompt.trim()) return
    
    try {
      setIsGenerating(true)
      setResult(null)
      
      if (mode === 'text') {
        const resultData = await generateImage({ prompt, ratio })
        setResult(resultData.data.url)
      } else {
        if (!sourceImage) {
          alert('Upload gambar referensi dulu')
          return
        }
        const resultData = await generateImageToImage({ base64Image: sourceImage, prompt, ratio })
        setResult(resultData.data.url)
      }
    } catch (error) {
      console.error(error)
      alert('Generation failed: ' + error.message)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Yuna AI home">
          <span className="brand-mark"><Icon name="sparkles" /></span>
          <span className="brand-text">Yuna<span>AI</span></span>
        </a>

        <nav className="side-nav" role="tablist">
          <span className="side-label">Studio</span>
          <button className={mode === 'text' ? 'side-item active' : 'side-item'} onClick={() => setMode('text')} type="button"><Icon name="sparkles" /> Text to image</button>
          <button className={mode === 'image' ? 'side-item active' : 'side-item'} onClick={() => setMode('image')} type="button"><Icon name="image" /> Image to image</button>
        </nav>

        <div className="side-footer">
          <span className="status"><i /> AI Studio online</span>
          <button className="avatar" type="button" aria-label="Account">Y</button>
        </div>
      </aside>

      <div className="main-col">
        <section className="hero" id="top">
          <div className="eyebrow"><Icon name="sparkles" /> CREATE WITHOUT LIMITS</div>
          <h1>Your ideas, rendered<br /><span>beautifully.</span></h1>
          <p>Turn a few words or an existing image into original visuals in seconds.</p>
        </section>

        <section className="studio">
          <div className="studio-head">
            <h2>{mode === 'text' ? 'Text to image' : 'Image to image'}</h2>
            <span className="studio-sub">{mode === 'text' ? 'Deskripsikan gambar yang kamu bayangkan' : 'Upload gambar lalu tulis instruksi transformasi'}</span>
          </div>

          <div className="workspace">
            <div className="controls">
              {mode === 'image' && (
                <div className="field-block">
                  <div className="field-label"><span>Reference image</span><small>Upload gambar sumber untuk ditransformasi (maks 8MB)</small></div>
                  {sourcePreview ? (
                    <div className="source-preview" style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
                      <img src={sourcePreview} alt="Reference" style={{ width: '100%', display: 'block', borderRadius: 12 }} />
                      <button type="button" onClick={() => { setSourceImage(null); setSourcePreview(null) }} style={{ position: 'absolute', top: 8, right: 8, border: 0, borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', background: 'rgba(0,0,0,.6)', color: '#fff', fontWeight: 700 }}>×</button>
                    </div>
                  ) : (
                    <label className="dropzone" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '28px 16px', border: '1.5px dashed rgba(255,255,255,.25)', borderRadius: 12 }}>
                      <span><Icon name="upload" /></span>
                      <strong>Upload gambar</strong>
                      <small>Klik untuk pilih file (PNG/JPG)</small>
                      <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>
              )}

              <div className="field-block prompt-block">
                <div className="field-label"><span>{mode === 'text' ? 'Describe your image' : 'Describe the transformation'}</span><small>{prompt.length}/500</small></div>
                <textarea value={prompt} maxLength="500" onChange={(event) => setPrompt(event.target.value)} placeholder={mode === 'text' ? 'A dreamy glass house in a lavender field at golden hour...' : 'Transform this into a dreamy watercolor illustration...'} />
                <button className="surprise" type="button" onClick={() => setPrompt('A futuristic botanical garden floating above the clouds, soft cinematic light')}><Icon name="sparkles" /> Surprise me</button>
              </div>

              <div className="option-grid">
                <label>Aspect ratio<select value={ratio} onChange={(event) => setRatio(event.target.value)}><option>1:1</option><option>16:9</option><option>4:3</option><option>9:16</option></select></label>
                <label>Visual style<select value={style} onChange={(event) => setStyle(event.target.value)}><option>Cinematic</option><option>Photorealistic</option><option>Watercolor</option><option>3D render</option><option>Editorial</option></select></label>
              </div>

              <button className="generate" disabled={!prompt.trim() || isGenerating || (mode === 'image' && !sourceImage)} onClick={generate} type="button">
                {isGenerating ? <><span className="spinner" /> Creating your image...</> : <><Icon name="sparkles" /> Generate image</>}
              </button>
            </div>

            <div className="output">
              {isGenerating ? (
                <div className="loading-state"><div className="orb" /><strong>Bringing your idea to life</strong><span>This usually takes a few seconds</span></div>
              ) : result ? (
                <div className="result-card"><img src={result} alt={prompt} /><div className="result-actions"><span>{style} · {ratio}</span><a href={result} download="yuna-ai.jpg" target="_blank" rel="noreferrer"><Icon name="download" /> Download</a></div></div>
              ) : (
                <div className="empty-state"><span className="empty-icon"><Icon name="image" /></span><strong>Your creation appears here</strong><p>Describe what you imagine, choose your settings, and let YunaAI do the rest.</p><div className="mini-cards"><i /><i /><i /></div></div>
              )}
            </div>
          </div>
        </section>

        <section className="inspiration">
          <div><span>Fresh inspiration</span><h2>Made with YunaAI</h2></div>
          <div className="gallery">
            {samples.map((sample) => <article key={sample.id} style={{ '--start': sample.colors[0], '--end': sample.colors[1] }}><div className="art"><span>{sample.title}</span></div><p>{sample.prompt}</p><button type="button" onClick={() => { setPrompt(sample.prompt); setMode('text'); window.scrollTo({ top: 400, behavior: 'smooth' }) }}><Icon name="plus" /> Use prompt</button></article>)}
          </div>
        </section>

        <footer><div className="brand"><span className="brand-mark"><Icon name="sparkles" /></span><span>Yuna<span>AI</span></span></div><p>Made for ideas that deserve to be seen.</p><span>© 2026 YunaAI</span></footer>
      </div>
    </div>
  )
}

export default App
