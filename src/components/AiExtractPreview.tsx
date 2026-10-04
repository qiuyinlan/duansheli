import { useMemo } from 'react'
import type { ItemDraft } from '../ai/convert'
import { useAppStore } from '../store/useAppStore'
import { IconAlert } from './ui/icons'
import { Button } from './ui/primitives'
import { statusLabel } from '../store/selectors'
import { useT } from '../i18n'

interface Props {
  drafts: ItemDraft[]
  onChange: (drafts: ItemDraft[]) => void
  /** 这一轮刚被改过的草稿 key —— 会加粗显示，方便看出「这次的成果」 */
  highlightKeys?: readonly string[]
}

/**
 * 批量录入的预览。
 *
 * 这一屏是整个 AI 功能里最重要的地方：AI 一定会认错、也一定会提出你不想要的分类，
 * 所以每一条都要能改、能取消，新分类/新位置必须由你点头才创建。
 */
export function AiExtractPreview({ drafts, onChange, highlightKeys }: Props) {
  const derived = useAppStore((s) => s.derived)
  const { t } = useT()

  const highlighted = useMemo(() => new Set(highlightKeys ?? []), [highlightKeys])
  const hasNewCategories = drafts.some((d) => d.newCategoryPaths.length > 0)
  const hasNewLocations = drafts.some((d) => d.newLocationPath !== null)

  /** 本次 AI 一共建议了哪些新分类（去重后按出现顺序） */
  const suggestedCategories = useMemo(() => {
    const out: string[] = []
    for (const draft of drafts) {
      for (const path of draft.newCategoryPaths) {
        const label = path.join(' / ')
        if (!out.includes(label)) out.push(label)
      }
    }
    return out
  }, [drafts])

  const update = (key: string, patch: Partial<ItemDraft>) => {
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  const mapAll = (patch: (draft: ItemDraft) => Partial<ItemDraft>) => {
    onChange(drafts.map((draft) => ({ ...draft, ...patch(draft) })))
  }

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="small muted">
          {t('ai.foundLead')}
          <strong className="numeric">{drafts.length}</strong>
          {t('ai.foundMid')}
          <strong className="numeric">{drafts.filter((d) => d.include).length}</strong>
          {t('ai.foundTail')}
        </div>
        <div className="row wrap">
          <Button size="sm" onClick={() => mapAll(() => ({ include: true }))}>
            {t('common.selectAll')}
          </Button>
          <Button size="sm" onClick={() => mapAll(() => ({ include: false }))}>
            {t('common.selectNone')}
          </Button>
          {hasNewCategories ? (
            <Button
              size="sm"
              onClick={() =>
                mapAll((d) => (d.newCategoryPaths.length > 0 ? { adoptNewCategories: true } : {}))
              }
            >
              {t('ai.adoptAllNewCategories')}
            </Button>
          ) : null}
          {hasNewLocations ? (
            <Button
              size="sm"
              onClick={() => mapAll((d) => (d.newLocationPath ? { adoptNewLocation: true } : {}))}
            >
              {t('ai.adoptAllNewLocations')}
            </Button>
          ) : null}
        </div>
      </div>

      {/*
        把「建议新建的分类」单独拎出来说一遍。
        之前只靠在每一行的标签上显示虚线 chip，很容易被忽略 ——
        结果就是用户直接点了确认，东西落到「未分类」里，
        或者被 AI 硬塞进了某个不相干的已有分类而没人发现。
      */}
      {suggestedCategories.length > 0 ? (
        <div className="notice notice--alert">
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body">
            {t('ai.suggestCategoriesLead')}
            <strong>{suggestedCategories.length}</strong>
            {t('ai.suggestCategoriesMid')}
            {suggestedCategories.join(t('ai.listSeparator'))}
            <br />
            {t('ai.suggestNotCheckedLead')}
            <strong>{t('ai.suggestNotCheckedBold')}</strong>
            {t('ai.suggestCategoriesTail')}
          </span>
          <span className="notice__action">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                mapAll((d) => (d.newCategoryPaths.length > 0 ? { adoptNewCategories: true } : {}))
              }
            >
              {t('ai.adoptAll')}
            </Button>
          </span>
        </div>
      ) : null}

      <div className="list">
        {drafts.map((draft) => (
          <div
            key={draft.key}
            className={`ai-row${draft.include ? '' : ' ai-row--skipped'}${
              highlighted.has(draft.key) ? ' ai-row--changed' : ''
            }`}
          >
            <input
              type="checkbox"
              className="row-checkbox"
              checked={draft.include}
              aria-label={t('ai.rowIncludeAria', { name: draft.name })}
              onChange={() => update(draft.key, { include: !draft.include })}
            />

            <div className="ai-row__main">
              {/* ---------------- 名称与数量 ---------------- */}
              <div className="row" style={{ gap: 'var(--gap-2)' }}>
                {/* 已有物品要标出来 —— 采纳时是「更新」不是「新建」 */}
                {draft.sourceItemId ? (
                  <span className="badge badge--accent" title={t('ai.existingBadgeTitle')}>
                    {t('ai.existingBadge')}
                  </span>
                ) : null}
                <input
                  className="input grow"
                  value={draft.name}
                  aria-label={t('ai.fieldNameAria')}
                  onChange={(e) => update(draft.key, { name: e.target.value })}
                />
                <input
                  className="input input--number"
                  style={{ width: 76, flexShrink: 0 }}
                  type="number"
                  min={1}
                  value={draft.quantity}
                  aria-label={t('ai.fieldQuantityAria')}
                  onChange={(e) =>
                    update(draft.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>

              {/* ---------------- 位置 ---------------- */}
              <div className="ai-row__line">
                <span className="ai-row__label">{t('ai.fieldLocation')}</span>
                {draft.locationId ? (
                  <span>{draft.locationLabel}</span>
                ) : draft.newLocationPath ? (
                  <button
                    type="button"
                    className={`chip${draft.adoptNewLocation ? ' is-active' : ''}`}
                    onClick={() => update(draft.key, { adoptNewLocation: !draft.adoptNewLocation })}
                    title={t('ai.newLocationToggleTitle')}
                  >
                    {draft.adoptNewLocation ? t('ai.willCreate') : t('ai.newPlace')}
                    {t('ai.labelColon')}
                    {draft.newLocationPath.join(' / ')}
                  </button>
                ) : (
                  <span className="dim">{t('status.unassigned')}</span>
                )}
              </div>

              {/* ---------------- 分类 ---------------- */}
              <div className="ai-row__line">
                <span className="ai-row__label">{t('ai.fieldCategories')}</span>
                <span className="chip-list">
                  {draft.matchedCategoryIds.map((id) => (
                    <span key={id} className="chip is-active">
                      {derived.categoryIndex.pathString(id, ' / ')}
                    </span>
                  ))}
                  {draft.newCategoryPaths.map((path) => (
                    <button
                      key={path.join('/')}
                      type="button"
                      className={`chip${draft.adoptNewCategories ? ' is-active' : ' chip--dashed'}`}
                      onClick={() =>
                        update(draft.key, { adoptNewCategories: !draft.adoptNewCategories })
                      }
                      title={t('ai.newCategoryToggleTitle')}
                    >
                      {draft.adoptNewCategories ? '' : '+ '}
                      {path.join(' / ')}
                    </button>
                  ))}
                  {draft.matchedCategoryIds.length === 0 &&
                  draft.newCategoryPaths.length === 0 ? (
                    <span className="dim small">{t('status.uncategorized')}</span>
                  ) : null}
                </span>
              </div>

              {/* ---------------- 标签 / 属性 / 备注 ---------------- */}
              {draft.tags.length > 0 || Object.keys(draft.attrs).length > 0 ? (
                <div className="ai-row__line">
                  <span className="ai-row__label" />
                  <span className="row wrap" style={{ gap: 'var(--gap-2)' }}>
                    {draft.tags.map((tag) => (
                      <span key={tag} className="badge">
                        #{tag}
                      </span>
                    ))}
                    {Object.entries(draft.attrs).map(([name, value]) => (
                      <span key={name} className="attr-chip">
                        <span className="attr-chip__name">{name}</span>
                        {value}
                      </span>
                    ))}
                  </span>
                </div>
              ) : null}

              {draft.note !== '' ? (
                <div className="ai-row__line">
                  <span className="ai-row__label">{t('ai.fieldNote')}</span>
                  <input
                    className="input"
                    value={draft.note}
                    aria-label={t('ai.fieldNote')}
                    onChange={(e) => update(draft.key, { note: e.target.value })}
                  />
                </div>
              ) : null}

              {/* ---------------- 状态 ---------------- */}
              {/*
                状态单独一行，而且**只在 AI 明确说了状态时才显示**。
                这一行是给「我说了闲置，它却给我打了个标签」那件事收尾的：
                用户要能一眼看见「闲置」被当成了状态，而不是一个标签。
                status 为 null（AI 没提）= 不动原有状态，所以不显示。
              */}
              {draft.status != null ? (
                <div className="ai-row__line">
                  <span className="ai-row__label">{t('ai.fieldStatus')}</span>
                  <span className="chip is-active">{statusLabel(draft.status)}</span>
                </div>
              ) : null}

              {/* ---------------- 活动 ---------------- */}
              {draft.matchedCollectionIds.length > 0 ? (
                <div className="ai-row__line">
                  <span className="ai-row__label">{t('ai.fieldCollections')}</span>
                  <span className="chip-list">
                    {draft.matchedCollectionIds.map((id) => (
                      <span key={id} className="chip is-active">
                        {derived.collectionById.get(id)?.name ?? id}
                      </span>
                    ))}
                  </span>
                </div>
              ) : null}

              {/* ---------------- 被丢掉的活动名 ---------------- */}
              {draft.droppedCollections.length > 0 ? (
                <div className="ai-row__line">
                  <span className="ai-row__label" />
                  <span className="tiny dim">
                    {t('ai.droppedCollectionsLead')}
                    {draft.droppedCollections.join(t('ai.listSeparator'))}
                    {t('ai.droppedCollectionsTail')}
                  </span>
                </div>
              ) : null}

              {/* ---------------- 被丢掉的属性名 ---------------- */}
              {draft.droppedAttrs.length > 0 ? (
                <div className="ai-row__line">
                  <span className="ai-row__label" />
                  <span className="tiny dim">
                    {t('ai.droppedAttrsLead')}
                    {draft.droppedAttrs.join(t('ai.listSeparator'))}
                    {t('ai.droppedAttrsTail')}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
