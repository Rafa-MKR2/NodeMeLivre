import { describe, expect, it, vi } from 'vitest'
import { type PageFetcher, paginate } from './pagination.js'

function page<T>(
  results: T[],
  total: number,
  offset: number,
): { results: T[]; paging: { total: number; offset: number; limit: number } } {
  return { results, paging: { total, offset, limit: 2 } }
}

describe('paginate', () => {
  it('deve iterar todas as páginas até o total', async () => {
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 5, 0)
      if (offset === 2) return page([3, 4], 5, 2)
      return page([5], 5, 4)
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
    }

    expect(items).toEqual([1, 2, 3, 4, 5])
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('deve parar quando a página vier vazia antes do total', async () => {
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 99, 0)
      return page([], 99, 2)
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
    }

    expect(items).toEqual([1, 2])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('deve respeitar o break do consumidor sem buscar a próxima página', async () => {
    const fetchPage: PageFetcher<number> = vi.fn(async (offset) => {
      if (offset === 0) return page([1, 2], 99, 0)
      if (offset === 2) return page([3, 4], 99, 2)
      return page([], 99, 4)
    })

    const items: number[] = []
    for await (const n of paginate(fetchPage, { limit: 2 })) {
      items.push(n)
      if (items.length >= 3) break
    }

    expect(items).toEqual([1, 2, 3])
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})
