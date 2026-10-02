import { useNavigate } from 'react-router-dom'
import { IconChevronRight, IconFolder, IconGear, IconSettings, IconSparkle, IconTag } from '../components/ui/icons'
import { useAppStore } from '../store/useAppStore'

/** 手机端的「更多」入口页。桌面端这些入口已经在侧栏里，不会走到这里。 */
export function More() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)

  const entries = [
    {
      to: '/ai',
      label: 'AI 助手',
      meta: '批量录入 · 整理',
      Icon: IconSparkle,
      desc: '粘贴一段文字，让 AI 帮你拆成物品',
    },
    {
      to: '/categories',
      label: '分类',
      meta: `${data.categories.length} 个`,
      Icon: IconFolder,
      desc: '你亲手维护的固定分类清单',
    },
    {
      to: '/attributes',
      label: '属性',
      meta: `${data.attributeDefs.length} 个`,
      Icon: IconSettings,
      desc: '品牌、购入日期、价格… 按需勾选使用',
    },
    {
      to: '/tags',
      label: '标签',
      meta: `${data.tags.length} 个`,
      Icon: IconTag,
      desc: '情境化标记，如「想送人」',
    },
    {
      to: '/settings',
      label: '设置',
      meta: '备份 · 导入 · 回收站',
      Icon: IconGear,
      desc: '导出数据，防止丢失',
    },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">更多</div>
        </div>
      </div>

      <div className="more-list">
        {entries.map((entry) => (
          <button
            key={entry.to}
            type="button"
            className="more-item"
            onClick={() => navigate(entry.to)}
          >
            <span className="more-item__icon">
              <entry.Icon size={18} />
            </span>
            <span className="more-item__label">
              <span style={{ display: 'block' }}>{entry.label}</span>
              <span className="tiny dim">{entry.desc}</span>
            </span>
            <span className="more-item__meta">{entry.meta}</span>
            <span className="more-item__caret">
              <IconChevronRight size={14} />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
