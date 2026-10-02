/** id 生成。优先用原生 crypto.randomUUID，老浏览器退回时间戳+随机串方案。 */
export function uid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // 退化实现：时间戳 + 两次随机，足够避免单机数据里的碰撞
  const rand = () => Math.random().toString(16).slice(2, 10)
  return `${Date.now().toString(16)}-${rand()}-${rand()}`
}
