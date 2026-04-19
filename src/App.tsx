import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, RotateCcw, Download, Sparkles, Move, Image as ImageIcon, Loader2, RotateCw, Sun, Contrast, Languages, ExternalLink } from 'lucide-react'

type Step = 'upload' | 'edit'
type Lang = 'zh' | 'en'

const i18n = {
  zh: {
    title: '翻拍照片修复工具',
    subtitle: '拖拽角点校正透视，保留照片完整内容',
    upload: '上传照片',
    dragDrop: '拖拽照片到此处，或点击选择',
    feature1: '透视校正',
    feature1Desc: '拖拽 4 个角点对齐照片边缘',
    feature2: '旋转修正',
    feature2Desc: '微调照片旋转角度',
    feature3: '色彩调整',
    feature3Desc: '调整亮度和对比度',
    adjusting: '校正与调整',
    resetCorners: '重置角点',
    rotation: '旋转',
    brightness: '亮度',
    contrast: '对比度',
    preview: '实时预览',
    downloadPng: '下载 PNG',
    startOver: '重新开始',
    processing: '处理中...',
    step1: '上传照片',
    step2: '校正 & 下载',
  },
  en: {
    title: 'Photo Restorer',
    subtitle: 'Drag corners to fix perspective, keep full photo content',
    upload: 'Upload Photo',
    dragDrop: 'Drag & drop a photo here, or click to select',
    feature1: 'Perspective Correction',
    feature1Desc: 'Drag 4 corners to align photo edges',
    feature2: 'Rotation Adjustment',
    feature2Desc: 'Fine-tune rotation angle',
    feature3: 'Color Adjustment',
    feature3Desc: 'Adjust brightness and contrast',
    adjusting: 'Correct & Adjust',
    resetCorners: 'Reset Corners',
    rotation: 'Rotation',
    brightness: 'Brightness',
    contrast: 'Contrast',
    preview: 'Live Preview',
    downloadPng: 'Download PNG',
    startOver: 'Start Over',
    processing: 'Processing...',
    step1: 'Upload Photo',
    step2: 'Correct & Download',
  },
}

interface Point { x: number; y: number }

function bilinear(corners: Point[], u: number, v: number): Point {
  const top = { x: corners[0].x * (1 - u) + corners[1].x * u, y: corners[0].y * (1 - u) + corners[1].y * u }
  const bot = { x: corners[3].x * (1 - u) + corners[2].x * u, y: corners[3].y * (1 - u) + corners[2].y * u }
  return { x: top.x * (1 - v) + bot.x * v, y: top.y * (1 - v) + bot.y * v }
}

function perspectiveTransform(srcCanvas: HTMLCanvasElement, srcCorners: Point[], dstWidth: number, dstHeight: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = dstWidth
  out.height = dstHeight
  const ctx = out.getContext('2d')!
  const src = srcCorners
  const dst: Point[] = [
    { x: 0, y: 0 }, { x: dstWidth, y: 0 },
    { x: dstWidth, y: dstHeight }, { x: 0, y: dstHeight },
  ]
  const gridX = 30, gridY = 30

  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const u0 = gx / gridX, v0 = gy / gridY
      const u1 = (gx + 1) / gridX, v1 = (gy + 1) / gridY
      const s00 = bilinear(src, u0, v0)
      const s10 = bilinear(src, u1, v0)
      const s01 = bilinear(src, u0, v1)
      const d00 = bilinear(dst, u0, v0)
      const d10 = bilinear(dst, u1, v0)
      const d11 = bilinear(dst, u1, v1)
      const d01 = bilinear(dst, u0, v1)

      const denom = (s10.x - s00.x) * (s01.y - s00.y) - (s10.y - s00.y) * (s01.x - s00.x)
      if (Math.abs(denom) < 0.001) continue

      const a = ((d10.x - d00.x) * (s01.y - s00.y) - (d01.x - d00.x) * (s10.y - s00.y)) / denom
      const b = ((d01.x - d00.x) * (s10.x - s00.x) - (d10.x - d00.x) * (s01.x - s00.x)) / denom
      const c = ((d10.y - d00.y) * (s01.y - s00.y) - (d01.y - d00.y) * (s10.y - s00.y)) / denom
      const d = ((d01.y - d00.y) * (s10.x - s00.x) - (d10.y - d00.y) * (s01.x - s00.x)) / denom
      const e = d00.x - a * s00.x - b * s00.y
      const f = d00.y - c * s00.x - d * s00.y

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(d00.x, d00.y)
      ctx.lineTo(d10.x, d10.y)
      ctx.lineTo(d11.x, d11.y)
      ctx.lineTo(d01.x, d01.y)
      ctx.closePath()
      ctx.clip()
      ctx.setTransform(a, c, b, d, e, f)
      ctx.drawImage(srcCanvas, 0, 0)
      ctx.restore()
    }
  }
  return out
}

function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    if (src instanceof Blob) {
      img.src = URL.createObjectURL(src)
    } else {
      img.src = src
    }
  })
}

function App() {
  const [step, setStep] = useState<Step>('upload')
  const [lang, setLang] = useState<Lang>('zh')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [corners, setCorners] = useState<Point[]>([])
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingIdx = useRef<number | null>(null)
  const t = i18n[lang]
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFile = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    const img = await loadImage(url)
    setImgSize({ w: img.width, h: img.height })
    const margin = Math.min(img.width, img.height) * 0.02
    setCorners([
      { x: margin, y: margin },
      { x: img.width - margin, y: margin },
      { x: img.width - margin, y: img.height - margin },
      { x: margin, y: img.height - margin },
    ])
    setRotation(0)
    setBrightness(100)
    setContrast(100)
    setPreviewUrl(null)
    setStep('edit')
  }, [])

  // Draw canvas with corners overlay (edit area)
  useEffect(() => {
    if (step !== 'edit' || !imageUrl || !canvasRef.current || !containerRef.current) return
    const canvas = canvasRef.current
    const container = containerRef.current
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const maxW = container.clientWidth - 32
      const maxH = 500
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      const dispW = img.width * scale
      const dispH = img.height * scale
      canvas.width = dispW
      canvas.height = dispH
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, dispW, dispH)
      ctx.drawImage(img, 0, 0, dispW, dispH)

      // Draw corner overlay
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(corners[0].x * scale, corners[0].y * scale)
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x * scale, corners[i].y * scale)
      ctx.closePath()
      ctx.stroke()
      ctx.setLineDash([])

      for (const c of corners) {
        ctx.beginPath()
        ctx.arc(c.x * scale, c.y * scale, 10, 0, Math.PI * 2)
        ctx.fillStyle = '#3b82f6'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    img.src = imageUrl
  }, [step, imageUrl, corners])

  // Update preview on changes (debounced)
  useEffect(() => {
    if (step !== 'edit' || !imageUrl || corners.length === 0) return
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    previewTimerRef.current = setTimeout(() => {
      updatePreview()
    }, 300)
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current) }
  }, [corners, rotation, brightness, contrast, step])

  const updatePreview = useCallback(async () => {
    if (!imageUrl || corners.length === 0 || imgSize.w === 0) return
    try {
      const srcImg = await loadImage(imageUrl)

      // Apply brightness/contrast first
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = srcImg.width
      srcCanvas.height = srcImg.height
      const srcCtx = srcCanvas.getContext('2d')!
      srcCtx.filter = `brightness(${brightness}%) contrast(${contrast}%)`
      srcCtx.drawImage(srcImg, 0, 0)

      // Apply rotation
      let workCanvas = srcCanvas
      let workCorners = [...corners]
      if (rotation !== 0) {
        const rad = (rotation * Math.PI) / 180
        const sin = Math.abs(Math.sin(rad))
        const cos = Math.abs(Math.cos(rad))
        const newW = srcImg.width * cos + srcImg.height * sin
        const newH = srcImg.width * sin + srcImg.height * cos
        const rotCanvas = document.createElement('canvas')
        rotCanvas.width = newW
        rotCanvas.height = newH
        const rotCtx = rotCanvas.getContext('2d')!
        rotCtx.translate(newW / 2, newH / 2)
        rotCtx.rotate(rad)
        rotCtx.drawImage(srcCanvas, -srcImg.width / 2, -srcImg.height / 2)

        const cx = srcImg.width / 2, cy = srcImg.height / 2
        workCorners = corners.map(c => {
          const dx = c.x - cx, dy = c.y - cy
          return {
            x: dx * Math.cos(rad) - dy * Math.sin(rad) + newW / 2,
            y: dx * Math.sin(rad) + dy * Math.cos(rad) + newH / 2,
          }
        })
        workCanvas = rotCanvas
      }

      // Perspective transform
      const w = Math.sqrt((workCorners[1].x - workCorners[0].x) ** 2 + (workCorners[1].y - workCorners[0].y) ** 2)
      const h = Math.sqrt((workCorners[3].x - workCorners[0].x) ** 2 + (workCorners[3].y - workCorners[0].y) ** 2)
      const result = perspectiveTransform(workCanvas, workCorners, Math.round(w), Math.round(h))
      setPreviewUrl(result.toDataURL('image/png'))
    } catch (err) {
      console.error(err)
    }
  }, [imageUrl, corners, rotation, brightness, contrast, imgSize])

  const getCanvasPoint = useCallback((e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    let clientX: number, clientY: number
    if ('touches' in e) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }
    const px = (clientX - rect.left) * scaleX
    const py = (clientY - rect.top) * scaleY
    const scale = canvas.width / (imgSize.w || canvas.width)
    return { x: px / scale, y: py / scale }
  }, [imgSize])

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current || imgSize.w === 0) return
    const pt = getCanvasPoint(e, canvasRef.current)
    const scale = canvasRef.current.width / imgSize.w
    const threshold = 20 * scale
    for (let i = 0; i < corners.length; i++) {
      const dx = corners[i].x * scale - pt.x * scale
      const dy = corners[i].y * scale - pt.y * scale
      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        draggingIdx.current = i
        break
      }
    }
  }, [corners, imgSize, getCanvasPoint])

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (draggingIdx.current === null || !canvasRef.current || imgSize.w === 0) return
    e.preventDefault()
    const pt = getCanvasPoint(e, canvasRef.current)
    setCorners(prev => {
      const next = [...prev]
      next[draggingIdx.current!] = { x: Math.max(0, Math.min(imgSize.w, pt.x)), y: Math.max(0, Math.min(imgSize.h, pt.y)) }
      return next
    })
  }, [imgSize, getCanvasPoint])

  const handlePointerUp = useCallback(() => { draggingIdx.current = null }, [])

  const resetCorners = useCallback(() => {
    if (imgSize.w === 0) return
    const margin = Math.min(imgSize.w, imgSize.h) * 0.02
    setCorners([
      { x: margin, y: margin },
      { x: imgSize.w - margin, y: margin },
      { x: imgSize.w - margin, y: imgSize.h - margin },
      { x: margin, y: imgSize.h - margin },
    ])
  }, [imgSize])

  const handleDownload = useCallback(() => {
    if (!previewUrl) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = 'restored_photo.png'
    a.click()
  }, [previewUrl])

  const startOver = useCallback(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setPreviewUrl(null)
    setImageUrl(null)
    setCorners([])
    setRotation(0)
    setBrightness(100)
    setContrast(100)
    setStep('upload')
  }, [imageUrl])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-gray-200/50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-800">{t.title}</span>
          </div>
          <div className="flex items-center gap-3">
            {step !== 'upload' && (
              <button onClick={startOver} className="text-sm text-gray-500 hover:text-gray-800 transition flex items-center gap-1">
                <RotateCcw className="w-4 h-4" />{t.startOver}
              </button>
            )}
            <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="text-sm text-gray-500 hover:text-gray-800 transition flex items-center gap-1">
              <Languages className="w-4 h-4" />{lang === 'zh' ? 'EN' : '中文'}
            </button>
          </div>
        </div>
      </header>

      {/* Upload Step */}
      {step === 'upload' && (
        <div className="max-w-5xl mx-auto px-4 py-12">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lift mb-6">
              <ImageIcon className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-3">{t.title}</h1>
            <p className="text-gray-500 text-lg">{t.subtitle}</p>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            className="border-2 border-dashed border-blue-300 rounded-2xl p-16 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all shadow-soft"
          >
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <Upload className="w-12 h-12 text-blue-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">{t.upload}</p>
            <p className="text-gray-400 text-sm mt-1">{t.dragDrop}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            {[
              { icon: Move, title: t.feature1, desc: t.feature1Desc },
              { icon: RotateCw, title: t.feature2, desc: t.feature2Desc },
              { icon: Contrast, title: t.feature3, desc: t.feature3Desc },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-6 shadow-soft">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-800 mb-1">{title}</h3>
                <p className="text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Step */}
      {step === 'edit' && (
        <div className="max-w-6xl mx-auto px-4 py-6">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
            <span>① {t.step1}</span>
            <span>→</span>
            <span className="text-blue-600 font-medium">② {t.step2}</span>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Left: Edit area with canvas */}
            <div>
              <div className="bg-white rounded-2xl p-4 shadow-soft" ref={containerRef}>
                <canvas
                  ref={canvasRef}
                  className="w-full cursor-crosshair rounded-xl"
                  onMouseDown={handlePointerDown}
                  onMouseMove={handlePointerMove}
                  onMouseUp={handlePointerUp}
                  onMouseLeave={handlePointerUp}
                  onTouchStart={handlePointerDown}
                  onTouchMove={handlePointerMove}
                  onTouchEnd={handlePointerUp}
                />
              </div>

              {/* Controls below canvas */}
              <div className="bg-white rounded-2xl p-5 shadow-soft mt-4 space-y-4">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <Move className="w-4 h-4 text-blue-600" />{t.adjusting}
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <button onClick={resetCorners} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition">
                    <RotateCcw className="w-4 h-4" />{t.resetCorners}
                  </button>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
                      <RotateCw className="w-3.5 h-3.5 text-blue-600" />{t.rotation}: {rotation}°
                    </label>
                    <input type="range" min={-45} max={45} step={0.5} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full accent-blue-600" />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
                      <Sun className="w-3.5 h-3.5 text-blue-600" />{t.brightness}: {brightness}%
                    </label>
                    <input type="range" min={50} max={150} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full accent-blue-600" />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
                      <Contrast className="w-3.5 h-3.5 text-blue-600" />{t.contrast}: {contrast}%
                    </label>
                    <input type="range" min={50} max={150} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full accent-blue-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div>
              <div className="bg-white rounded-2xl p-4 shadow-soft h-full flex flex-col">
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600" />{t.preview}
                </h3>
                <div className="flex-1 flex items-center justify-center min-h-[300px] bg-gray-50 rounded-xl">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Preview" className="max-w-full max-h-[60vh] rounded-xl shadow-soft" />
                  ) : (
                    <div className="text-gray-400 text-center">
                      <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin" />
                      <p className="text-sm">{t.processing}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Download button */}
              <button
                onClick={handleDownload}
                disabled={!previewUrl}
                className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium shadow-lift hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />{t.downloadPng}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-400">
        <div className="flex items-center justify-center gap-1">
          Built with ❤️ ·{' '}
          <a href="https://github.com/Thomaszhou22/photo_restorer" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-gray-600">
            <ExternalLink className="w-3.5 h-3.5" /> GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
