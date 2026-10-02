import type { ItemDraft } from '../ai/convert'
import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/primitives'

interface Props {
  drafts: ItemDraft[]
  onChange: (drafts: ItemDraft[]) => void
}

/**
 * 批量录入的预览。
 *
 * 这一屏是整个 AI 功能里最重要的地方：AI 一定会认错、也一定会提出你不想要的分类，
 * 所以每一条都要能改、能取消，新分类/新位置必须由你点头才创建。
 */
export function AiExtractPreview({ drafts, onChange }: Props) {
  const derived = useAppStore((s) => s.derived)
  const hasNewCategories = drafts.some((d) => d.newCategoryNames.length > 0)
  const hasNewLocations = drafts.some((d) => d.newLocationPath !== null)

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
          识别出 <strong className="numeric">{drafts.length}</strong> 条，已选{' '}
          <strong className="numeric">{drafts.filter((d) => d.include).length}</strong> 条
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
                mapAll((d) => (d.newCategoryNames.length > 0 ? { adoptNewCategories: true } : {}))
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
          <div
            key={draft.key}
            className={`ai-row${draft.include ? '' : ' ai-row--skipped'}`}
          >
            <input
              type="checkbox"
              className="row-checkbox"
              checked={draft.include}
              aria-label={`是否录入「${draft.name}」`}
              onChange={() => update(draft.key, { include: !draft.include })}
            />

            <div className="ai-row__main">
              {/* ---------------- 名称与数量 ---------------- */}
              <div className="row" style={{ gap: 'var(--gap-2)' }}>
                <input
                  className="input grow"
                  value={draft.name}
                  aria-label="物品名称"
                  onChange={(e) => update(draft.key, { name: e.target.value })}
                />
                <input
                  className="input input--number"
                  style={{ width: 76, flexShrink: 0 }}
                  type="number"
                  min={1}
                  value={draft.quantity}
                  aria-label="数量"
                  onChange={(e) =>
                    update(draft.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>

              {/* ---------------- 位置 ---------------- */}
              <div className="ai-row__line">
                <span className="ai-row__label">位置</span>
                {draft.locationId ? (
                  <span>{draft.locationLabel}</span>
                ) : draft.newLocationPath ? (
                  <button
                    type="button"
                    className={`chip${draft.adoptNewLocation ? ' is-active' : ''}`}
                    onClick={() => update(draft.key, { adoptNewLocation: !draft.adoptNewLocation })}
                    title="点击切换：是否创建这个位置"
                  >
                    {draft.adoptNewLocation ? '将创建' : '新位置'}：
                    {draft.newLocationPath.join(' / ')}
                  </button>
                ) : (
                  <span className="dim">未归位</span>
                )}
              </div>

              {/* ---------------- 分类 ---------------- */}
              <div className="ai-row__line">
                <span className="ai-row__label">分类</span>
                <span className="chip-list">
                  {draft.matchedCategoryIds.map((id) => (
                    <span key={id} className="chip is-active">
                      {derived.categoryById.get(id)?.name ?? '（已删除）'}
                    </span>
                  ))}
                  {draft.newCategoryNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`chip${draft.adoptNewCategories ? ' is-active' : ' chip--dashed'}`}
                      onClick={() =>
                        update(draft.key, { adoptNewCategories: !draft.adoptNewCategories })
                      }
                      title="这是 AI 建议的新分类。点击切换：是否创建"
                    >
                      {draft.adoptNewCategories ? '' : '+ '}
                      {name}
                    </button>
                  ))}
                  {draft.matchedCategoryIds.length === 0 &&
                  draft.newCategoryNames.length === 0 ? (
                    <span className="dim small">未分类</span>
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
                  <span className="ai-row__label">备注</span>
                  <input
                    className="input"
                    value={draft.note}
                    aria-label="备注"
                    onChange={(e) => update(draft.key, { note: e.target.value })}
                  />
                </div>
              ) : null}

              {/* ---------------- 被丢掉的属性名 ---------------- */}
              {draft.droppedAttrs.length > 0 ? (
                <div className="ai-row__line">
                  <span className="ai-row__label" />
                  <span className="tiny dim">
                    AI 还提到 {draft.droppedAttrs.join('、')}，但你的属性库里没有这些属性，已忽略。
                    （想记录的话，去「属性」页面先定义它们）
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
