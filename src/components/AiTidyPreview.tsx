import type { TidyDraft } from '../ai/convert'
import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/primitives'

interface Props {
  drafts: TidyDraft[]
  onChange: (drafts: TidyDraft[]) => void
}

/**
 * 整理建议的预览。
 *
 * 一律做成「当前 → 建议」的对照，因为这里的每个改动都会覆盖你原来的数据 ——
 * 看不到原值就没法判断该不该采纳。
 */
export function AiTidyPreview({ drafts, onChange }: Props) {
  const derived = useAppStore((s) => s.derived)
  const hasNewCategories = drafts.some((d) => d.newCategoryPaths.length > 0)
  const hasNewLocations = drafts.some((d) => d.newLocationPath !== null)

  const update = (key: string, patch: Partial<TidyDraft>) => {
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  const mapAll = (patch: (draft: TidyDraft) => Partial<TidyDraft>) => {
    onChange(drafts.map((draft) => ({ ...draft, ...patch(draft) })))
  }

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="small muted">
          有 <strong className="numeric">{drafts.length}</strong> 项建议，已选{' '}
          <strong className="numeric">{drafts.filter((d) => d.include).length}</strong> 项
        </div>
        <div className="row wrap">
          <Button size="sm" onClick={() => mapAll(() => ({ include: true }))}>
            全选
          </Button>
          <Button size="sm" onClick={() => mapAll(() => ({ include: false }))}>
            全不选
          </Button>
          {hasNewCategories ? (
            <Button
              size="sm"
              onClick={() =>
                mapAll((d) => (d.newCategoryPaths.length > 0 ? { adoptNewCategories: true } : {}))
              }
            >
              采纳全部新分类
            </Button>
          ) : null}
          {hasNewLocations ? (
            <Button
              size="sm"
              onClick={() => mapAll((d) => (d.newLocationPath ? { adoptNewLocation: true } : {}))}
            >
              采纳全部新位置
            </Button>
          ) : null}
        </div>
      </div>

      <div className="list">
        {drafts.map((draft) => (
          <div key={draft.key} className={`ai-row${draft.include ? '' : ' ai-row--skipped'}`}>
            <input
              type="checkbox"
              className="row-checkbox"
              checked={draft.include}
              aria-label={`是否采纳对「${draft.itemName}」的修改`}
              onChange={() => update(draft.key, { include: !draft.include })}
            />

            <div className="ai-row__main">
              <div className="ai-row__title">{draft.itemName}</div>

              {/* ---------------- 分类对照 ---------------- */}
              <div className="ai-row__line">
                <span className="ai-row__label">分类</span>
                <span className="row wrap" style={{ gap: 'var(--gap-2)' }}>
                  <span className="dim">
                    {draft.currentCategoryPaths.length > 0
                      ? draft.currentCategoryPaths.map((path) => path.join(' / ')).join('、')
                      : '未分类'}
                  </span>
                  <span className="dim">→</span>
                  {draft.matchedCategoryIds.length === 0 &&
                  draft.newCategoryPaths.length === 0 ? (
                    <span className="dim small">不变</span>
                  ) : (
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
                          title="AI 建议的新分类。点击切换：是否创建"
                        >
                          {draft.adoptNewCategories ? '' : '+ '}
                          {path.join(' / ')}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </div>

              {/* ---------------- 位置对照 ---------------- */}
              <div className="ai-row__line">
                <span className="ai-row__label">位置</span>
                <span className="row wrap" style={{ gap: 'var(--gap-2)' }}>
                  <span className="dim">{draft.currentLocationLabel}</span>
                  <span className="dim">→</span>
                  {draft.locationId ? (
                    <span className="badge badge--solid">
                      {derived.index.pathString(draft.locationId, ' / ')}
                    </span>
                  ) : draft.newLocationPath ? (
                    <button
                      type="button"
                      className={`chip${draft.adoptNewLocation ? ' is-active' : ' chip--dashed'}`}
                      onClick={() =>
                        update(draft.key, { adoptNewLocation: !draft.adoptNewLocation })
                      }
                      title="点击切换：是否创建这个位置"
                    >
                      {draft.adoptNewLocation ? '将创建' : '新位置'}：
                      {draft.newLocationPath.join(' / ')}
                    </button>
                  ) : (
                    <span className="dim small">不变</span>
                  )}
                </span>
              </div>

              {draft.reason !== '' ? (
                <div className="ai-row__line">
                  <span className="ai-row__label">理由</span>
                  <span className="dim small">{draft.reason}</span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
