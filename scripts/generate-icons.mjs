/**
 * 生成 PWA 图标与 favicon。
 *
 * 设计：黑色底 + 三条逐渐变窄的白色横杠 ——
 * 「一堆东西，越往上越少」，正好是断舍离的意思，也跟界面的极简无彩色风格一致。
 *
 * 不引任何图形库，直接用 zlib 手写 PNG 编码。
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
  [0.30, 0.45, 0.70, 0.55],
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

const BG = 0x1a // #1a1a1a
const FG = 0xff // #ffffff

/** 超采样渲染，让边缘平滑 */
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
      const alpha = hits / samples
      const value = Math.round(BG + alpha * (FG - BG))
      const offset = (py * size + px) * 4
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = value
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

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect width="16" height="16" fill="#1a1a1a"/>
  <g fill="#ffffff">
    <rect x="3.52" y="4.56" width="8.96" height="1.6" rx="0.8"/>
    <rect x="4.8" y="7.2" width="6.4" height="1.6" rx="0.8"/>
    <rect x="6.16" y="9.84" width="3.68" height="1.6" rx="0.8"/>
  </g>
</svg>
`
writeFileSync(resolve(publicDir, 'favicon.svg'), svg)
console.log(`已生成 ${resolve(publicDir, 'favicon.svg')}`)
