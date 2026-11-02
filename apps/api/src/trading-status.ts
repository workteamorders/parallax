export function builderFee(value: number): number {
  return Math.max(0, Math.min(100, 1000, Number.isFinite(value) ? Math.floor(value) : 20));
}
/**
 * Browser-side devnet trading is a UI capability flag only. The server never builds, signs or relays
 * a transaction (`POST /trade` stays 403), and mainnet-beta can never be enabled from configuration.
 */
export function tradingStatus(network: 'devnet' | 'mainnet-beta', flag: 'true' | 'false', builderFee_: number) {
  const enabled = network === 'devnet' && flag === 'true';
  return {
    enabled,
    network,
    reason: enabled
      ? 'Devnet test trading is enabled in the browser. Your own wallet signs every transaction; this server never signs, holds keys, or relays orders. Test funds only.'
      : network === 'devnet'
        ? 'Trading disabled. Set DEVNET_TRADING_ENABLED=true to enable devnet test trading in the browser.'
        : 'Trading disabled. Mainnet trading is not implemented; research only.',
    builderFeeTenthsBp: builderFee_,
  };
}
