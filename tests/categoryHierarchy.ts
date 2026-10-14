import {
  applyCategoryPlan,
  countEffectiveCategoryChanges,
  planCategoryChanges,
  type CategoryChange,
} from '../src/ai/categoryEdit'
import { parseChatResponse } from '../src/ai/parse'
import { eq, fixture, must, test } from './harness'

await test('planned category parents resolve regardless of model output order', () => {
  const data = fixture()
  const changes: CategoryChange[] = [
    { kind: 'create', path: ['Digital notes', 'Flomo'], newName: 'Flomo' },
    { kind: 'create', path: ['Digital notes'], newName: 'Digital notes' },
    { kind: 'create', path: ['Digital notes', 'Flomo', 'Learning'], newName: 'Learning' },
  ]

  const plan = planCategoryChanges(data, changes)
  eq(plan.problems, 0)
  eq(countEffectiveCategoryChanges(plan.entries), 3)

  const result = applyCategoryPlan(data, plan.entries)
  eq(result.created, 3)
  const root = must(result.data.categories.find((category) => category.name === 'Digital notes'), 'root category')
  const platform = must(result.data.categories.find((category) => category.name === 'Flomo'), 'platform category')
  const leaf = must(result.data.categories.find((category) => category.name === 'Learning'), 'leaf category')
  eq(platform.parentId, root.id)
  eq(leaf.parentId, platform.id)
})

await test('unselected planned parent excludes its descendants from apply', () => {
  const data = fixture()
  const plan = planCategoryChanges(data, [
    { kind: 'create', path: ['Digital notes'], newName: 'Digital notes' },
    { kind: 'create', path: ['Digital notes', 'Flomo'], newName: 'Flomo' },
  ])
  const entries = plan.entries.map((entry) =>
    entry.dependsOn === undefined ? { ...entry, include: false } : entry,
  )

  eq(countEffectiveCategoryChanges(entries), 0)
  eq(applyCategoryPlan(data, entries).created, 0)
})

await test('create parentPath survives model response parsing and yields nested preview paths', () => {
  const parsed = parseChatResponse({
    reply: 'Create the folder tree',
    categoryChanges: [
      { kind: 'create', path: ['Digital notes'], newName: 'Digital notes', parentPath: [] },
      {
        kind: 'create',
        path: ['Digital notes', 'Flomo'],
        newName: 'Flomo',
        parentPath: ['Digital notes'],
      },
    ],
  })
  eq(parsed.categoryChanges[1]?.parentPath?.join('/'), 'Digital notes')

  const data = fixture()
  const plan = planCategoryChanges(data, parsed.categoryChanges, 'digital')
  eq(plan.problems, 0)
  eq(plan.entries[1]?.toLabel, 'Digital notes / Flomo')
  const result = applyCategoryPlan(data, plan.entries)
  const root = must(result.data.categories.find((category) => category.name === 'Digital notes'), 'digital root')
  const child = must(result.data.categories.find((category) => category.name === 'Flomo'), 'digital child')
  eq(root.assetType, 'digital')
  eq(child.assetType, 'digital')
  eq(child.parentId, root.id)
})

await test('digital category with the same name as a physical category remains a separate tree', () => {
  const data = fixture()
  const physical = must(data.categories.find((category) => category.name === '衣物'), 'physical category')
  const plan = planCategoryChanges(
    data,
    [{ kind: 'create', path: ['衣物'], newName: '衣物', parentPath: [] }],
    'digital',
  )
  eq(plan.entries[0]?.status, 'ok')

  const result = applyCategoryPlan(data, plan.entries)
  const sameNameCategories = result.data.categories.filter((category) => category.name === '衣物')
  eq(sameNameCategories.length, 2)
  eq(sameNameCategories.find((category) => category.assetType === 'physical')?.id, physical.id)
  eq(sameNameCategories.find((category) => category.assetType === 'digital')?.parentId, null)
})
