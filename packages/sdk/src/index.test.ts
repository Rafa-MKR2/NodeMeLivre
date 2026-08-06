import { json, mockFetch, restoreFetch } from '@nodemelivre/core/test-utils'
import { ConfigurationError } from '@nodemelivre/errors'
import { afterEach, describe, expect, it } from 'vitest'
import { createMercadoLivre } from './index.js'

const fakeItem = {
  id: 'MLB1',
  site_id: 'MLB',
  title: 'Produto',
  seller_id: 1,
  category_id: 'C',
  price: 10,
  currency_id: 'BRL',
  available_quantity: 1,
  sold_quantity: 0,
  buying_mode: 'buy_it_now',
  listing_type_id: 'gold_special',
  condition: 'new',
  status: 'active',
  date_created: '2026-01-01',
  last_updated: '2026-01-01',
}

function setup() {
  return createMercadoLivre({ clientId: 'APP_ID', clientSecret: 'SECRET', siteId: 'MLB' })
}

afterEach(() => {
  restoreFetch()
})

describe('MercadoLivre', () => {
  it('deve expor todos os resources', () => {
    const ml = setup()
    expect(ml.items).toBeDefined()
    expect(ml.orders).toBeDefined()
    expect(ml.users).toBeDefined()
    expect(ml.shipments).toBeDefined()
    expect(ml.questions).toBeDefined()
    expect(ml.images).toBeDefined()
    expect(ml.tokens).toBeDefined()
    expect(ml.auth).toBeDefined()
    expect(ml.http).toBeDefined()
  })

  it('deve lançar ConfigurationError com mensagem clara sem credenciais', () => {
    expect(() => createMercadoLivre({} as never)).toThrow(ConfigurationError)
    expect(() => createMercadoLivre({} as never)).toThrow(/ML_CLIENT_ID/)
  })

  it('deve montar a URL de autorização com siteId', () => {
    const url = setup().authorizationUrl('https://app.com/cb', 'state-1')
    expect(url).toContain('https://auth.mercadolivre.com.br/authorization')
    expect(url).toContain('client_id=APP_ID')
    expect(url).toContain('state=state-1')
  })

  it('deve autenticar via authorization_code e usar o token nas chamadas', async () => {
    mockFetch((_url, init) => {
      const rawBody = init.body
      const headers = new Headers(init.headers)

      if (typeof rawBody === 'string' && rawBody.includes('authorization_code')) {
        return json({
          access_token: 'token-1',
          token_type: 'bearer',
          expires_in: 21600,
          scope: 'offline_access read write',
          user_id: 1,
          refresh_token: 'refresh-1',
        })
      }

      expect(headers.get('authorization')).toBe('Bearer token-1')
      return json(fakeItem)
    })

    const ml = setup()
    await ml.authenticate('https://app.com/cb', 'code-1')
    const item = await ml.items.get('MLB1')

    expect(item.id).toBe('MLB1')
    expect((await ml.tokens.current())?.accessToken).toBe('token-1')
  })
})
