import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { useT } from '../../i18n'
import { IconAlert, IconCheck, IconClose, IconSearch, IconStar } from './icons'

/* ------------------------------------------------------------------ */
/* 按钮                                                                */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
}

export function Button({
  variant = 'default',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

export function IconButton({ label, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn--icon ${className ?? ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 置顶（那颗星）                                                      */
/* ------------------------------------------------------------------ */

interface PinButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** 已经置顶了 —— 实心星 */
  pinned: boolean
  /** 给读屏软件念的名字（位置 / 分类名） */
  name: string
}

/**
 * 「置顶」那颗星。
 *
 * ── 为什么单独做一个组件 ────────────────────────────────────────
 * 它出现在三个地方（AI 输入框的候选、位置选择弹窗、分类选择弹窗），
 * 而它有三个容易写错的地方：
 *   1. `aria-pressed` 必须跟着状态走 —— 否则读屏软件念不出「已置顶」
 *   2. 鼠标**按下**时不能把焦点抢走（AI 补全那里，失焦就等于光标丢了）
 *   3. 点它**不能**顺带把这一条选中（那会把用户正打的位置覆盖掉）
 * 前两条在这里一次做对；第三条由调用方在 onClick 里 stopPropagation。
 *
 * 星星的实心 / 空心是唯一的状态区分 —— 加个「已置顶」小字会把
 * 弹层里的候选挤得看不清。
 */
export function PinButton({ pinned, name, className, ...rest }: PinButtonProps) {
  const { t } = useT()
  const label = t(pinned ? 'common.unpinAria' : 'common.pinAria', { name })

  return (
    <button
      type="button"
      className={['pin-btn', pinned ? 'is-on' : '', className ?? ''].filter(Boolean).join(' ')}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      /* 不让输入框失焦：失焦了光标位置就没了，用户接着打字会跳回去 */
      onMouseDown={(e) => e.preventDefault()}
      {...rest}
    >
      <IconStar size={13} filled={pinned} />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* 空状态                                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__title">{title}</div>
      {hint ? <div className="empty-state__hint">{hint}</div> : null}
      {action ? <div style={{ marginTop: 'var(--gap-2)' }}>{action}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 搜索框                                                              */
/* ------------------------------------------------------------------ */

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onValueChange: (value: string) => void
}

export function SearchInput({ value, onValueChange, ...rest }: SearchInputProps) {
  const { t } = useT()

  return (
    <div className="search">
      <span className="search__icon">
        <IconSearch />
      </span>
      <input
        className="input"
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        {...rest}
      />
      {value !== '' ? (
        <button
          type="button"
          className="search__clear"
          aria-label={t('common.clearSearchAria')}
          onClick={() => onValueChange('')}
        >
          <IconClose size={13} />
        </button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 开关与复选框                                                        */
/* ------------------------------------------------------------------ */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
      <span>{label}</span>
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* 模态框                                                              */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  maxWidth?: number
}

export function Modal({ open, title, onClose, children, footer, maxWidth }: ModalProps) {
  const { t } = useT()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // 只有点在背景上才关闭，避免拖动选择文字时误关
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="modal__header">
          <div className="modal__title">{title}</div>
          <IconButton label={t('common.closeAria')} onClick={onClose}>
            <IconClose />
          </IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ */
/* 确认对话框                                                          */
/* ------------------------------------------------------------------ */

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // 默认按钮文字要在这里取，不能写成模块级常量 ——
  // 那会在模块加载时把语言冻住，切换语言后对话框还是旧语言。
  const { t } = useT()
  const confirm = confirmLabel ?? t('common.confirm')
  const cancel = cancelLabel ?? t('common.cancel')

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      maxWidth={400}
      footer={
        <>
          <Button onClick={onCancel}>{cancel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.75, color: 'var(--text-2)' }}>
        {message}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 轻提示                                                              */
/* ------------------------------------------------------------------ */

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  const { t } = useT()

  if (toasts.length === 0) return null

  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.tone === 'error' ? ' toast--error' : ''}`}>
          {toast.tone === 'error' ? (
            <IconAlert />
          ) : toast.tone === 'success' ? (
            <IconCheck />
          ) : null}
          <span className="grow">{toast.message}</span>
          <button
            type="button"
            className="toast__close"
            aria-label={t('common.closeAlertAria')}
            onClick={() => dismiss(toast.id)}
          >
            <IconClose size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
