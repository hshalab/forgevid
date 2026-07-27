/**
 * E-commerce product ingestion — a store's catalogue into a video per SKU.
 *
 * A DTC brand needs dozens of usable ad assets a week, not one perfect video,
 * and creating a custom video for every SKU by hand is not economic. Point us at
 * the product feed the store already publishes and each product becomes a
 * narrated, captioned ad with its price burned in — then the ad-variation engine
 * multiplies the winners into hooks and placements for testing.
 *
 * Handles the feeds a store actually has:
 *  - Google Merchant Center (XML, RSS 2.0 with the g: namespace: g:title,
 *    g:price, g:image_link, ...). fast-xml-parser drops the prefix, so we alias
 *    both `g:title` and `title`.
 *  - Shopify / generic JSON (`{ products: [...] }` or a bare array).
 *  - WooCommerce's REST API product object (`name`, `regular_price`,
 *    `sale_price`, `short_description`, `images[].src`) and BigCommerce's
 *    catalog Product object (`name`, `price`, `calculated_price`,
 *    `images[].url_standard`) — both already match most of the Shopify/generic
 *    aliases below; only their price/description field names differ.
 *
 * Nothing is invented: a product with no image is rejected by name. The parser
 * is PURE and shares lib/feed-core with real estate and automotive.
 *
 * Relative imports only — reachable from the worker process.
 */

import {
  FeedParseError,
  asPrice,
  asText,
  extractPhotos,
  parseFeed,
  pick,
  pickAll,
  type FeedShape,
} from './feed-core';
import type { LowerThird } from './lower-third';

export interface Product {
  /** The store's SKU / product id, echoed back. */
  ref: string;
  title: string;
  price?: string;
  brand?: string;
  /** The store's own product description / selling points. */
  description?: string;
  photos: string[];
}

export class ProductParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductParseError';
  }
}

const ALIASES = {
  ref: ['id', 'g:id', 'sku', 'productId', 'product_id', 'variant_id', 'ref', 'mpn'],
  title: ['title', 'g:title', 'name', 'productTitle', 'product_title'],
  // regular_price/calculated_price: WooCommerce's and BigCommerce's own names
  // for list price when it differs from the current selling price.
  price: ['price', 'g:price', 'sale_price', 'g:sale_price', 'salePrice', 'amount', 'regular_price', 'calculated_price'],
  brand: ['brand', 'g:brand', 'vendor', 'manufacturer'],
  // short_description: WooCommerce's excerpt field, separate from the full description.
  description: ['description', 'g:description', 'body_html', 'bodyHtml', 'summary', 'details', 'short_description'],
  media: [
    'image_link', 'g:image_link', 'additional_image_link', 'g:additional_image_link',
    'images', 'image', 'featured_image', 'imageUrl', 'photos', 'media', 'src',
  ],
};

/** Strip HTML (Shopify's body_html) down to plain sentences for a voiceover. */
function plainText(value: unknown): string | undefined {
  const raw = asText(value);
  if (!raw) return undefined;
  const stripped = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || undefined;
}

const PRODUCT_SHAPE: FeedShape<Product> = {
  identityAliases: ALIASES.title,
  noun: 'product',
  toItem(record, index) {
    const title = asText(pick(record, ALIASES.title));
    const photos = extractPhotos(pickAll(record, ALIASES.media));
    const ref = asText(pick(record, ALIASES.ref)) ?? `feed-${index + 1}`;

    if (!title) throw new ProductParseError(`Feed entry ${index + 1} (${ref}): no title`);
    if (photos.length === 0) throw new ProductParseError(`Feed entry ${index + 1} (${title}): no image`);

    return {
      ref,
      title,
      price: asPrice(pick(record, ALIASES.price)),
      brand: asText(pick(record, ALIASES.brand)),
      description: plainText(pick(record, ALIASES.description))?.slice(0, 1000),
      photos,
    };
  },
};

export function parseProductFeed(text: string, contentType = ''): Product[] {
  try {
    return parseFeed(text, contentType, PRODUCT_SHAPE);
  } catch (error) {
    if (error instanceof FeedParseError) throw new ProductParseError(error.message);
    throw error;
  }
}

/** The generation prompt: facts only, no invented claims about the product. */
export function productPrompt(product: Product, sceneCount: number): string {
  return [
    `A short, punchy product ad for ${product.title}${product.brand ? ` by ${product.brand}` : ''}.`,
    product.price ? `It is priced at ${product.price}.` : '',
    product.description ? `About it: ${product.description}.` : '',
    `There are ${sceneCount} product images, shown in order.`,
    'Write an energetic direct-response voiceover that sells the product using ONLY',
    'the information above — never invent features, materials, claims, or a price.',
    'End with a clear call to action to shop now.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Product + "$49.00 · Brand" burned into the opening seconds. */
export function productLowerThird(product: Product): LowerThird {
  return {
    title: product.title,
    facts: [product.price, product.brand].filter((f): f is string => Boolean(f)),
    start: 0.6,
    duration: 4,
  };
}
