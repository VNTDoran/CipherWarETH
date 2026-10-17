/** INTEL has 18 decimals, like ETH. Shown as a plain number, trimmed. */
export function formatIntel(wei: string | bigint | null | undefined): string {
  if (wei === null || wei === undefined) return "—";
  const v = typeof wei === "bigint" ? wei : BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = ((v % 10n ** 18n) * 100n) / 10n ** 18n; // two decimals
  const base = whole.toLocaleString("en-US");
  return frac === 0n ? base : `${base}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}
