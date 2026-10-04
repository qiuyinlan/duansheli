import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconChecklist,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconGear,
  IconSettings,
  IconSpare,
  IconSparkle,
  IconSuitcase,
  IconTag,
} from '../components/ui/icons'
import { useT } from '../i18n'
import { computeStats, spareItems, totalUnits } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'

/** 手机端的「更多」入口页。桌面端这些入口已经在侧栏里，不会走到这里。 */
export function More() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const soonDays = useAppStore((s) => s.ui.expirySoonDays)

  // useT() 一方面是拿 t/tc，另一方面是**订阅语言**：
  // 语言一换这个页面就会重新渲染，下面那些文案才会跟着变。
  const { t, tc } = useT()

  const stats = useMemo(() => computeStats(data, soonDays), [data, soonDays])
  const urgentCount = stats.expiredCount + stats.expiringSoonCount
  // 徽标和侧栏一样显示**件数**：囤东西的人关心的是「还剩几件」
  const spareUnits = useMemo(() => totalUnits(spareItems(data)), [data])

  const entries = [
    {
      to: '/ai',
      label: t('nav.ai'),
      meta: t('more.aiMeta'),
      Icon: IconSparkle,
      desc: t('more.aiDesc'),
    },
    {
      to: '/expiry',
      label: t('nav.expiry'),
      meta:
        urgentCount > 0
          ? tc(urgentCount, 'more.expiryMetaUrgent')
          : t('more.expiryMetaClear'),
      Icon: IconClock,
      desc: t('more.expiryDesc'),
    },
    {
      to: '/collections',
      label: t('nav.collections'),
      meta: t('more.count', { count: data.collections.length }),
      Icon: IconSuitcase,
      desc: t('more.collectionsDesc'),
    },
    {
      to: '/checklists',
      label: t('nav.checklists'),
      meta: t('more.count', { count: data.checklists.length }),
      Icon: IconChecklist,
      desc: t('more.checklistsDesc'),
    },
    {
      to: '/spare',
      label: t('nav.spare'),
      meta:
        spareUnits > 0
          ? t('spare.highlightUnits', { count: spareUnits })
          : t('more.spareMetaEmpty'),
      Icon: IconSpare,
      desc: t('more.spareDesc'),
    },
    {
      to: '/categories',
      label: t('nav.categories'),
      meta: t('more.count', { count: data.categories.length }),
      Icon: IconFolder,
      desc: t('more.categoriesDesc'),
    },
    {
      to: '/attributes',
      label: t('nav.attributes'),
      meta: t('more.count', { count: data.attributeDefs.length }),
      Icon: IconSettings,
      desc: t('more.attributesDesc'),
    },
    {
      to: '/tags',
      label: t('nav.tags'),
      meta: t('more.count', { count: data.tags.length }),
      Icon: IconTag,
      desc: t('more.tagsDesc'),
    },
    {
      to: '/settings',
      label: t('nav.settings'),
      meta: t('more.settingsMeta'),
      Icon: IconGear,
      desc: t('more.settingsDesc'),
    },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleMore')}</div>
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
              <span className="more-item__name">{entry.label}</span>
              <span className="more-item__desc">{entry.desc}</span>
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
