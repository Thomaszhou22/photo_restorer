import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, RotateCcw, Download, ArrowLeft, Sparkles, Move, Image as ImageIcon, Loader2, RotateCw, Sun, Contrast, Languages, ExternalLink } from 'lucide-react'
import { removeBackground } from '@imgly/background-removal'

type Step = 'upload' | 'edit' | 'download'
type Lang = 'zh' | 'en'

const i18n = {
  zh: {
    title: '翻拍照片修复工具',
    subtitle: '去除翻拍背景，校正透视变形',
    upload: '上传照片',
    dragDrop: '拖拽照片到此处，或点击选择',
    feature1: 'AI 去背景',
    feature1Desc: '智能识别并去除翻拍时多出的背景',
    feature2: '透视校正',
    feature2Desc: '拖拽角点校正照片的透视变形',
    feature3: '旋转修正',
    feature3Desc: '微调旋转角度，让照片更端正',
    removingBg: '正在去除背景...',
    adjusting: '调整校正',
    resetCorners: '重置角点',
    rotation: '旋转',
    brightness: '亮度',
    contrast: '对比度',
    applyEdit: '应用并预览',
    preview: '预览',
    download: '下载照片',
    downloadPng: '下载 PNG',
    backToEdit: '返回编辑',
    startOver: '重新开始',
    processing: '处理中...',
  },
  en: {
    title: 'Photo Restorer',
    subtitle: 'Remove background & fix perspective distortion',
    upload: 'Upload Photo',
    dragDrop: 'Drag & drop a photo here, or click to select',
    feature1: 'AI Background Removal',
    feature1Desc: 'Smart removal of extra background from scanned photos',
    feature2: 'Perspective Correction',
    feature2Desc: 'Drag corners to fix perspective distortion',
    feature3: 'Rotation Adjustment',
    feature3Desc: 'Fine-tune rotation for a straighter photo',
    removingBg: 'Removing background...',
    adjusting: 'Adjust & Correct',
    resetCorners: 'Reset Corners',
    rotation: 'Rotation',
    brightness: 'Brightness',
    contrast: 'Contrast',
    applyEdit: 'Apply & Preview',
    preview: 'Preview',
    download: 'Download Photo',
    downloadPng: 'Download PNG',
    backToEdit: 'Back to Edit',
    startOver: 'Start Over',
    processing: 'Processing...',
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
      bilinear(src, u1, v1)
      const s01 = bilinear(src, u0, v1)
      const d00 = bilinear(dst, u0, v0)
      const d10 = bilinear(dst, u1, v0)
      const d11 = bilinear(dst, u1, v1)
      const d01 = bilinear(dst, u0, v1)

      // Compute affine transform for this quad
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
  const [bgRemovedUrl, setBgRemovedUrl] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [corners, setCorners] = useState<Point[]>([])
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingIdx = useRef<number | null>(null)
  const t = i18n[lang]

  // Preload model
  useEffect(() => {
    removeBackground(new Blob(), { progress: () => {} }).catch(() => {})
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setRemoving(true)
    setProgress(0)
    try {
      const blob = await removeBackground(file, {
        progress: (_key: string, current: number, total: number) => {
          if (total > 0) setProgress(Math.round((current / total) * 100))
        },
      })
      const url = URL.createObjectURL(blob)
      setBgRemovedUrl(url)

      const img = await loadImage(url)
      setImgSize({ w: img.width, h: img.height })
      const margin = Math.min(img.width, img.height) * 0.02
      setCorners([
        { x: margin, y: margin },
        { x: img.width - margin, y: margin },
        { x: img.width - margin, y: img.height - margin },
        { x: margin, y: img.height - margin },
      ])
      setStep('edit')
    } catch (err) {
      console.error(err)
      alert('Failed to process image')
    } finally {
      setRemoving(false)
      setProgress(0)
    }
  }, [])

  // Draw canvas with corners overlay
  useEffect(() => {
    if (step !== 'edit' || !bgRemovedUrl || !canvasRef.current || !containerRef.current) return
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

      // Apply filters
      ctx.save()
      const rad = (rotation * Math.PI) / 180
      ctx.translate(dispW / 2, dispH / 2)
      ctx.rotate(rad)
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`
      ctx.drawImage(img, -dispW / 2, -dispH / 2, dispW, dispH)
      ctx.restore()

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

      // Draw corner handles
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
    img.src = bgRemovedUrl
  }, [step, bgRemovedUrl, corners, rotation, brightness, contrast])

  // Canvas mouse/touch handlers for dragging corners
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

  const applyEdits = useCallback(async () => {
    if (!bgRemovedUrl) return
    setProcessing(true)
    try {
      // Load bg-removed image
      const srcImg = await loadImage(bgRemovedUrl)
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = srcImg.width
      srcCanvas.height = srcImg.height
      const srcCtx = srcCanvas.getContext('2d')!
      srcCtx.filter = `brightness(${brightness}%) contrast(${contrast}%)`
      srcCtx.drawImage(srcImg, 0, 0)

      // Rotate
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

        // Remap corners to rotated space
        const cx = srcImg.width / 2, cy = srcImg.height / 2
        const rotCorners = corners.map(c => {
          const dx = c.x - cx, dy = c.y - cy
          return {
            x: dx * Math.cos(rad) - dy * Math.sin(rad) + newW / 2,
            y: dx * Math.sin(rad) + dy * Math.cos(rad) + newH / 2,
          }
        })

        // Perspective transform
        const w = Math.sqrt((rotCorners[1].x - rotCorners[0].x) ** 2 + (rotCorners[1].y - rotCorners[0].y) ** 2)
        const h = Math.sqrt((rotCorners[3].x - rotCorners[0].x) ** 2 + (rotCorners[3].y - rotCorners[0].y) ** 2)
        const result = perspectiveTransform(rotCanvas, rotCorners, Math.round(w), Math.round(h))
        setResultUrl(result.toDataURL('image/png'))
      } else {
        const w = Math.sqrt((corners[1].x - corners[0].x) ** 2 + (corners[1].y - corners[0].y) ** 2)
        const h = Math.sqrt((corners[3].x - corners[0].x) ** 2 + (corners[3].y - corners[0].y) ** 2)
        const result = perspectiveTransform(srcCanvas, corners, Math.round(w), Math.round(h))
        setResultUrl(result.toDataURL('image/png'))
      }
      setStep('download')
    } catch (err) {
      console.error(err)
    } finally {
      setProcessing(false)
    }
  }, [bgRemovedUrl, corners, rotation, brightness, contrast])

  const handleDownload = useCallback(() => {
    if (!resultUrl) return
    const a = document.createElement('a')
    a.href = resultUrl
    a.download = 'restored_photo.png'
    a.click()
  }, [resultUrl])

  const startOver = useCallback(() => {
    if (bgRemovedUrl) URL.revokeObjectURL(bgRemovedUrl)
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setBgRemovedUrl(null)
    setResultUrl(null)
    setCorners([])
    setRotation(0)
    setBrightness(100)
    setContrast(100)
    setStep('upload')
  }, [bgRemovedUrl, resultUrl])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-gray-200/50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-800">{t.title}</span>
          </div>
          <div className="flex items-center gap-3">
            {step !== 'upload' && (
              <button
                onClick={startOver}
                className="text-sm text-gray-500 hover:text-gray-800 transition flex items-center gap-1"
              >
                <RotateCcw className="w-4 h-4" />
                {t.startOver}
              </button>
            )}
            <button
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="text-sm text-gray-500 hover:text-gray-800 transition flex items-center gap-1"
            >
              <Languages className="w-4 h-4" />
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </div>
        </div>
      </header>

      {/* Upload Step */}
      {step === 'upload' && (
        <div className="max-w-5xl mx-auto px-4 py-12">
          {/* Hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lift mb-6">
              <ImageIcon className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-3">
              {t.title}
            </h1>
            <p className="text-gray-500 text-lg">{t.subtitle}</p>
          </div>

          {/* Upload Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            className="border-2 border-dashed border-blue-300 rounded-2xl p-16 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all shadow-soft"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            <Upload className="w-12 h-12 text-blue-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">{t.upload}</p>
            <p className="text-gray-400 text-sm mt-1">{t.dragDrop}</p>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            {[
              { icon: Sparkles, title: t.feature1, desc: t.feature1Desc },
              { icon: Move, title: t.feature2, desc: t.feature2Desc },
              { icon: RotateCw, title: t.feature3, desc: t.feature3Desc },
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

      {/* Removing BG overlay */}
      {removing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-lift max-w-sm w-full mx-4 text-center">
            <Loader2 className="w-10 h-10 text-blue-500 mx-auto mb-4 animate-spin" />
            <p className="font-medium text-gray-800 mb-2">{t.removingBg}</p>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-sm text-gray-400 mt-2">{progress}%</p>
          </div>
        </div>
      )}

      {/* Edit Step */}
      {step === 'edit' && (
        <div className="max-w-5xl mx-auto px-4 py-8">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
            <span className="text-blue-600 font-medium">① {lang === 'zh' ? '去背景' : 'Remove BG'}</span>
            <span>→</span>
            <span className="text-blue-600 font-medium">{t.adjusting}</span>
            <span>→</span>
            <span>③ {t.download}</span>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Canvas area */}
            <div className="lg:col-span-2" ref={containerRef}>
              <div className="bg-white rounded-2xl p-4 shadow-soft">
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
            </div>

            {/* Controls */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-5 shadow-soft space-y-5">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <Move className="w-4 h-4 text-blue-600" />
                  {t.adjusting}
                </h3>

                <button
                  onClick={resetCorners}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  {t.resetCorners}
                </button>

                {/* Rotation */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <RotateCw className="w-4 h-4 text-blue-600" />
                    {t.rotation}: {rotation}°
                  </label>
                  <input
                    type="range" min={-45} max={45} step={0.5} value={rotation}
                    onChange={(e) => setRotation(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                {/* Brightness */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Sun className="w-4 h-4 text-blue-600" />
                    {t.brightness}: {brightness}%
                  </label>
                  <input
                    type="range" min={50} max={150} value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                {/* Contrast */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Contrast className="w-4 h-4 text-blue-600" />
                    {t.contrast}: {contrast}%
                  </label>
                  <input
                    type="range" min={50} max={150} value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>

              <button
                onClick={applyEdits}
                disabled={processing}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium shadow-lift hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {processing ? t.processing : t.applyEdit}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download Step */}
      {step === 'download' && resultUrl && (
        <div className="max-w-3xl mx-auto px-4 py-12">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-8 text-sm text-gray-500">
            <span>① {lang === 'zh' ? '去背景' : 'Remove BG'}</span>
            <span>→</span>
            <span>② {t.adjusting}</span>
            <span>→</span>
            <span className="text-blue-600 font-medium">③ {t.download}</span>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-soft">
            <div className="flex justify-center mb-6">
              <img src={resultUrl} alt="Result" className="max-w-full max-h-[60vh] rounded-xl shadow-soft" />
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={handleDownload}
                className="px-8 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium shadow-lift hover:shadow-lg transition flex items-center gap-2"
              >
                <Download className="w-5 h-5" />
                {t.downloadPng}
              </button>
              <button
                onClick={() => { setStep('edit') }}
                className="px-8 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition flex items-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" />
                {t.backToEdit}
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
