export function builderFee(value: number): number {
  return Math.max(0, Math.min(100, 1000, Number.isFinite(value) ? Math.floor(value) : 20));
}
/**
 * Browser-side trading is a UI capability flag only. The server never builds, signs or relays a transaction
 * (`POST /trade` stays 403). Devnet is enabled by DEVNET_TRADING_ENABLED. Mainnet is enabled only by its own,
 * separate MAINNET_TRADING_ENABLED, so the devnet flag can never switch real-money trading on by accident.
 * The browser adds its own hard limits on mainnet (apps/web/lib/trade-network.ts).
 */
export function tradingStatus(
  network: 'devnet' | 'mainnet-beta',
  flag: 'true' | 'false',
  builderFee_: number,
  mainnetFlag: 'true' | 'false' = 'false',
) {
  const enabled = network === 'devnet' ? flag === 'true' : mainnetFlag === 'true';
  return {
    enabled,
    network,
    reason: enabled
      ? network === 'devnet'
        ? 'Devnet test trading is enabled in the browser. Your own wallet signs every transaction; this server never signs, holds keys, or relays orders. Test funds only.'
        : 'MAINNET trading is enabled in the browser with hard limits on deposit and order size. Real funds. Your own wallet signs every transaction; this server never signs, holds keys, or relays orders.'
      : network === 'devnet'
        ? 'Trading disabled. Set DEVNET_TRADING_ENABLED=true to enable devnet test trading in the browser.'
        : 'Trading disabled. Mainnet trading is off; set MAINNET_TRADING_ENABLED=true only after reading docs/MAINNET-CHECKLIST.md.',
    builderFeeTenthsBp: builderFee_,
  };
}
