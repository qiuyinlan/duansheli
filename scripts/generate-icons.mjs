/**
 * 生成 PWA 图标与 favicon。
 *
 * 形状还是那个形状：**三条越来越短的横杠** ——「一堆东西，越往上越少」，
 * 正好是断舍离的意思。
 *
 * ── 底色为什么从黑变成彩色（2026 这一轮）───────────────────────
 * 用户的原话：「图标换一下，我不想要黑白的」。
 * 上一版是黑底（#1a1a1a）+ 白杠，跟界面的极简无彩色是一路的，
 * 但它出现在**桌面 / 主屏 / 浏览器标签**上 —— 那些地方周围全是别人的彩色图标，
 * 一个黑方块在那里看起来像「没加载出来的图」。
 *
 * 所以底色换成一条斜向渐变（青绿 → 靛蓝），横杠仍然是白色：
 *   · 保留原来的形状，认识它的人一眼还认得出来
 *   · 白色压在深色渐变上对比够，缩到 16px 也不会糊
 *   · 只换颜色，不加任何新元素 —— 图标越简单，缩得越小越站得住
 *
 * 不引任何图形库，直接手写 PNG 编码（zlib）+ 一个 SVG。
 * 运行：node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')
mkdirSync(publicDir, { recursive: true })

/* ------------------------------------------------------------------ */
/* PNG 编码                                                            */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型：RGBA
  ihdr[10] = 0 // 压缩方式
  ihdr[11] = 0 // 滤波方式
  ihdr[12] = 0 // 隔行扫描

  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // 每行的滤波字节：0 = None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* 图形                                                                */
/* ------------------------------------------------------------------ */

/** 归一化坐标下的三条横杠：[x0, y0, x1, y1]，两端为半圆 */
const BARS = [
  [0.22, 0.285, 0.78, 0.385],
  [0.3, 0.45, 0.7, 0.55],
  [0.385, 0.615, 0.615, 0.715],
]

function inRoundRect(fx, fy, x0, y0, x1, y1, r) {
  if (fx < x0 || fx > x1 || fy < y0 || fy > y1) return false
  const cx = Math.min(Math.max(fx, x0 + r), x1 - r)
  const cy = Math.min(Math.max(fy, y0 + r), y1 - r)
  const dx = fx - cx
  const dy = fy - cy
  return dx * dx + dy * dy <= r * r
}

function inBars(fx, fy) {
  for (const [x0, y0, x1, y1] of BARS) {
    if (inRoundRect(fx, fy, x0, y0, x1, y1, (y1 - y0) / 2)) return true
  }
  return false
}

/**
 * 底色渐变：左上青绿 → 右下靛蓝。
 *
 * 两端的取色不是随手挑的：
 *   · 青绿（#0d9488）就是这个项目「位置」那个板块的主色，
 *     而位置正是这个应用里最核心的那张图
 *   · 靛蓝（#4338ca）是「物品」板块的主色偏深一档
 * 于是图标和界面是同一套语言，而不是另起一个品牌色。
 */
const GRADIENT_FROM = [0x0d, 0x94, 0x88]
const GRADIENT_TO = [0x43, 0x38, 0xca]
const BAR_RGB = [0xff, 0xff, 0xff]

function gradientColor(t) {
  const k = Math.min(1, Math.max(0, t))
  return [
    GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * k,
    GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * k,
    GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * k,
  ]
}

/** 超采样渲染，让横杠的边缘平滑（渐变的底色本身是连续的，不需要超采样） */
function renderIcon(size, superSample = 4) {
  const rgba = Buffer.alloc(size * size * 4)
  const samples = superSample * superSample
  const total = size * superSample

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < superSample; sy++) {
        const fy = (py * superSample + sy + 0.5) / total
        for (let sx = 0; sx < superSample; sx++) {
          const fx = (px * superSample + sx + 0.5) / total
          if (inBars(fx, fy)) hits++
        }
      }

      // 这条杠盖住了多少 —— 用来把白杠和底色混在一起，边缘才有过渡
      const alpha = hits / samples
      const cx = (px + 0.5) / size
      const cy = (py + 0.5) / size
      const base = gradientColor((cx + cy) / 2)

      const offset = (py * size + px) * 4
      for (let channel = 0; channel < 3; channel++) {
        const value = base[channel] + alpha * (BAR_RGB[channel] - base[channel])
        rgba[offset + channel] = Math.round(value)
      }
      rgba[offset + 3] = 255
    }
  }

  return rgba
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

for (const size of [192, 512]) {
  const png = encodePng(size, size, renderIcon(size))
  const target = resolve(publicDir, `icon-${size}.png`)
  writeFileSync(target, png)
  console.log(`已生成 ${target}（${png.length} 字节）`)
}

/*
 * favicon 用 SVG：同一套形状，同一个渐变。
 *
 * 16px 下渐变只占几像素、几乎看不出过渡，但整体色调是对的 ——
 * 重要的是它**不是黑白方块**了，在标签页那一排里一眼能认出来。
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d9488"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect width="16" height="16" fill="url(#g)"/>
  <g fill="#ffffff">
    <rect x="3.52" y="4.56" width="8.96" height="1.6" rx="0.8"/>
    <rect x="4.8" y="7.2" width="6.4" height="1.6" rx="0.8"/>
    <rect x="6.16" y="9.84" width="3.68" height="1.6" rx="0.8"/>
  </g>
</svg>
`
writeFileSync(resolve(publicDir, 'favicon.svg'), svg)
console.log(`已生成 ${resolve(publicDir, 'favicon.svg')}`)
