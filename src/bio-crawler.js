import { CamoFoxSession } from './camofox/index.js';

export class BioLinkCrawler {
  #session

  constructor() {
    this.#session = null;
  }

  async crawlUrl(bioLink) {
    const url = this.#normalizeUrl(bioLink);
    if (!url) return {};

    const domain = this.#getDomain(url);
    if (!domain) return {};

    if (domain === 'amazon.com') {
      return { name: null, state: null, source: 'amazon-skip' };
    }

    if (domain === 'shopltk.com') {
      return this.#extractFromShopLTK(url);
    }

    // All other domains: use CamoFox for snapshot crawling
    if (!this.#session) {
      this.#session = new CamoFoxSession('backfill-' + Math.random().toString(36).slice(2, 10));
      await this.#session.init();
    }

    const result = await this.#crawlViaCamox(url, domain);
    return result;
  }

  async cleanup() {
    if (this.#session) {
      await this.#session.cleanup();
      this.#session = null;
    }
  }

  async #crawlViaCamox(url, domain) {
    try {
      await this.#session.navigate(url);
      await this.#session.waitForLoad(2500);

      const snapshot = await this.#session.getSnapshot({ format: 'text' });
      if (!snapshot || !snapshot.snapshot) return {};

      const text = snapshot.snapshot;
      const name = this.#extractNameFromText(text);
      const state = this.#extractStateFromText(text);

      const sourceMap = {
        'linktr.ee': 'linktree',
        'beacons.ai': 'beacons',
        'hoo.be': 'hoo',
        'youtube.com': 'youtube',
        'instagram.com': 'instagram',
      };

      return {
        name,
        state,
        source: sourceMap[domain] || domain || 'unknown',
      };
    } catch {
      return {};
    }
  }

  async #extractFromShopLTK(url) {
    try {
      const slugMatch = url.match(/shopltk\.com\/([^\/\?]+)/i);
      if (!slugMatch) return {};

      const rawName = slugMatch[1];
      const parsedName = this.#parseCamelCaseToName(rawName);

      if (parsedName && parsedName.length >= 3) {
        return {
          name: parsedName,
          source: 'shopltk-url',
        };
      }

      return {};
    } catch {
      return {};
    }
  }

  #normalizeUrl(rawUrl) {
    if (!rawUrl) return null;
    let url = rawUrl.trim();
    if (url.match(/^https?:\/\//)) return url;

    if (url.includes('.')) {
      return 'https://' + url;
    }

    if (url.includes('/')) {
      return 'https://' + url;
    }

    return null;
  }

  #getDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return null;
    }
  }

  #extractNameFromText(text) {
    if (!text) return null;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l.length < 100);

    const namePatterns = [
      /^(?:real|actually|the|this is)\s*(?:name|creator|influencer)\s*[:\-]?\s*(.+)$/i,
      /^(.+)\s*(?:is a|lives in|is from|based in|content creator|tiktok influencer|college student|sorority)/i,
      /^(.+)\s*(?:\.|\.\.\.|—|\-)\s*(?:a\s+|is\s+|lives\s+|was\s+)/i,
    ];

    for (const line of lines) {
      const skipWords = new Set([
        'home', 'link', 'shop', 'follow', 'subscribe', 'watch', 'visit',
        'new', 'video', 'post', 'check', 'out', 'now', 'here', 'my',
        'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
        'or', 'but', 'with', 'by', 'from', 'that', 'this', 'it', 'is',
        'are', 'was', 'been', 'be', 'have', 'has', 'had', 'do', 'does',
        'did', 'will', 'would', 'could', 'should', 'may', 'might',
        'bio', 'bio link', 'links', 'all my', 'also',
        'youtube', 'instagram', 'tiktok', 'twitter', 'facebook',
        'shopmy', 'liketok', 'amazon', 'wishlist',
        'linktr', 'beacon', 'shopltk', 'hoo.be',
        'click', 'tap', 'see', 'get', 'shop', 'buy',
        'affiliate', 'discount', 'code', 'use',
        'college', 'university', 'state', 'city',
      ]);

      const words = line.split(/\s+/);
      if (words.length >= 2 && words.length <= 6) {
        const hasSkipWord = words.some(w => skipWords.has(w.toLowerCase()));
        if (!hasSkipWord) return line;
      }

      for (const pattern of namePatterns) {
        const match = line.match(pattern);
        if (match) {
          const cleaned = match[1].trim().replace(/^[^\w]+|[^\w]+$/g, '');
          if (cleaned.length >= 2) return cleaned;
        }
      }
    }

    return null;
  }

  #extractStateFromText(text, targetCountry = 'US') {
    if (!text) return null;

    const stateRegexes = {
      US: [
        /(?:lives?\s+in|based\s+in|from|in\s+(?:the\s+state\s+of)?)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:,|\.|\s)/g,
        /\b(AK|AL|AR|AZ|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WI|WV|WY)\b/g,
      ],
    };

    const patterns = stateRegexes[targetCountry] || [];
    let bestMatch = null;

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text))) {
        const val = match[1] || match[0];
        if (val.length >= 2 && val.length <= 40) {
          if (!bestMatch) bestMatch = val;
          if (val.length >= 4 && bestMatch.length > 4) {
            bestMatch = val;
          }
        }
      }
    }

    return bestMatch;
  }

  #parseCamelCaseToName(text) {
    if (!text) return null;
    return text.replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
