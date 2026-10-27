/** Never format in the device zone and then label the result as the activity zone. */
export function formatActivityTime(value: string | null, timezone: string): string {
  if (!value) return '时间待定';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间格式暂不可用';
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const displayedZone = formatter.resolvedOptions().timeZone;
    if (!displayedZone) throw new Error('Timezone formatting unavailable');
    const utcAliases = ['utc', 'etc/utc', 'etc/gmt', 'gmt'];
    // Some lightweight runtimes silently ignore timeZone. An unverified alias also takes the safe UTC path.
    if (displayedZone.toLowerCase() !== timezone.toLowerCase() && !(utcAliases.includes(displayedZone.toLowerCase()) && utcAliases.includes(timezone.toLowerCase()))) throw new Error('Requested timezone not confirmed');
    // Always label the actual formatter zone rather than a guessed device/activity zone.
    return `${formatter.format(date)} · ${displayedZone}`;
  } catch {
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} · UTC（无法确认活动时区显示，已回退 UTC）`;
  }
}
