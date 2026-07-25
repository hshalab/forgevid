jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/safe-fetch', () => ({ safeFetch: jest.fn() }));

import { getServerSession } from 'next-auth';
import { safeFetch } from '@/lib/safe-fetch';
import { POST } from '@/app/api/media/validate-urls/route';

const mockedSession = getServerSession as jest.Mock;
const mockedFetch = safeFetch as jest.Mock;

function request(body: unknown) {
  return { json: async () => body } as any;
}

describe('POST /api/media/validate-urls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
  });

  it('rejects the original detail page without fetching it', async () => {
    const url = 'https://dealer.example/inventory/2020-honda-civic/77211';
    const response = await POST(request({ urls: [url], sourceUrl: url }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      valid: false,
      invalid: [{ reason: expect.stringContaining('not a direct photo URL') }],
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('accepts a fetchable direct image', async () => {
    mockedFetch.mockResolvedValue({ body: Buffer.from('image'), contentType: 'image/jpeg' });
    const response = await POST(request({ urls: ['https://cdn.example/car.jpg'] }));
    await expect(response.json()).resolves.toMatchObject({ valid: true, invalid: [] });
  });

  it('explains when a URL resolves to a web page', async () => {
    mockedFetch.mockRejectedValue(new Error('Unexpected content type: text/html'));
    const response = await POST(request({ urls: ['https://dealer.example/car'] }));
    await expect(response.json()).resolves.toMatchObject({
      valid: false,
      invalid: [{ reason: 'This URL opens a web page, not an image.' }],
    });
  });
});
