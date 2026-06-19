import type { EventParser } from './index.js';
import type { RawEvent, RawSwap, ParseContext } from '../types/index.js';

/**
 * Central registry for protocol-specific event parsers.
 *
 * To add a new DEX:
 *   1. Implement EventParser in src/parsers/<dex>.ts
 *   2. Call registry.register(myParser) in index.ts
 *
 * Parsers are tried in registration order. The first one whose canParse()
 * returns true handles the event — no fallthrough between parsers.
 */
export class ParserRegistry {
  private readonly parsers: EventParser[] = [];

  register(parser: EventParser): this {
    this.parsers.push(parser);
    return this;
  }

  canParse(event: RawEvent): boolean {
    return this.parsers.some((p) => p.canParse(event));
  }

  async parse(event: RawEvent, context: ParseContext): Promise<RawSwap | null> {
    for (const parser of this.parsers) {
      if (!parser.canParse(event)) continue;
      const res = await parser.parse(event, context);
      if (res !== null) return res;
    }
    return null;
  }

  get names(): string[] {
    return this.parsers.map((p) => p.name);
  }

  get size(): number {
    return this.parsers.length;
  }
}
