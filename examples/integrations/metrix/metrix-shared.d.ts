// The part of Metrix's `@metrix/shared` the gate reads, so this folder typechecks alone.
export interface IntentOrder {
  clientOrderId: string;
  venue: 'kuru' | 'perpl' | 'sim';
  market: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: string;
  size: string;
  strategy: string;
  reason: string;
}
