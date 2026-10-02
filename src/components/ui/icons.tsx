import type { ReactNode } from 'react'

/** 统一的行内 SVG 图标：16×16、1.5px 描边、无填充，跟极简风格一致 */
interface IconProps {
  size?: number
  className?: string
}

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const IconOverview = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 7 8 2l6 5v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    <path d="M6.5 14V9.5h3V14" />
  </Svg>
)

export const IconItems = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
    <path d="M2.75 4h.01M2.75 8h.01M2.75 12h.01" strokeWidth={2} />
  </Svg>
)

export const IconLocations = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75 2.5 4.5 8 7.25l5.5-2.75z" />
    <path d="m2.5 8 5.5 2.75L13.5 8" />
    <path d="m2.5 11.25 5.5 2.75 5.5-2.75" />
  </Svg>
)

export const IconIdle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.25 5.5h11.5v8H2.25z" />
    <path d="M1.75 2.5h12.5v3H1.75z" />
    <path d="M6.5 8.5h3" />
  </Svg>
)

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3.5h10M3 8h10M3 12.5h10" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.25" cy="7.25" r="4.5" />
    <path d="m10.75 10.75 2.75 2.75" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
)

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Svg>
)

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.75 3.5 5.25 8l4.5 4.5" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.25 8.5 3 3 6.5-7.5" />
  </Svg>
)

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.25 4.5h11.5M2.25 11.5h11.5" />
    <circle cx="6" cy="4.5" r="1.75" />
    <circle cx="10.5" cy="11.5" r="1.75" />
  </Svg>
)

export const IconTag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 7.4V2.9a.4.4 0 0 1 .4-.4h4.5L13.4 8.5 8.5 13.4z" />
    <path d="M5.6 5.6h.01" strokeWidth={2} />
  </Svg>
)

export const IconLayers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75 2.5 4.5 8 7.25l5.5-2.75z" />
    <path d="m2.5 8 5.5 2.75L13.5 8" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.25v8" />
    <path d="M4.5 7 8 10.5 11.5 7" />
    <path d="M2.5 13.5h11" />
  </Svg>
)

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10.75v-8" />
    <path d="M4.5 6 8 2.5 11.5 6" />
    <path d="M2.5 13.5h11" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.75 4.75h10.5" />
    <path d="M6.25 4.75V3h3.5v1.75" />
    <path d="M4.25 4.75 4.75 14h6.5l.5-9.25" />
  </Svg>
)

export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="m11 2.5 2.5 2.5L6 12.5H3.5V10z" />
  </Svg>
)

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Svg>
)

/** 有效期：一个日历，顶部有两个小挂钩 */
export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.25" y="3.5" width="11.5" height="10.25" rx="1.5" />
    <path d="M2.25 6.5h11.5M5.5 2.25v2.5M10.5 2.25v2.5" />
  </Svg>
)

/** 语言：一个地球，中英切换按钮旁边配它 */
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M2.25 8h11.5" />
    <path d="M8 2.25c1.6 1.8 2.4 3.7 2.4 5.75S9.6 12.2 8 13.75C6.4 11.95 5.6 10.05 5.6 8S6.4 4.05 8 2.25Z" />
  </Svg>
)

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 1 1 1.6 3.67" />
    <path d="M2.75 3.5v3.25H6" />
  </Svg>
)

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.25 1.5h6.25a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1z" />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.5M8 10.75h.01" strokeWidth={1.75} />
  </Svg>
)

export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v1.6M8 12.65v1.6M1.75 8h1.6M12.65 8h1.6M3.58 3.58l1.13 1.13M11.29 11.29l1.13 1.13M12.42 3.58l-1.13 1.13M4.71 11.29 3.58 12.42" />
  </Svg>
)

/** 四角星 —— 用来代表 AI */
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75 9.35 6.15 13.75 7.5 9.35 8.85 8 13.25 6.65 8.85 2.25 7.5 6.65 6.15z" />
  </Svg>
)
