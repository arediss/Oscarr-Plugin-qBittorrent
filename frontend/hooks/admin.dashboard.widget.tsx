import { useEffect, useState } from 'react';
import { Download, Upload, AlertCircle } from 'lucide-react';
import { api, formatSpeed, type Torrent, type TransferInfo } from '../api';

const REFRESH_MS = 5000;
const TOP_N = 5;

export default function QbitOverviewWidget() {
  const [torrents, setTorrents] = useState<Torrent[] | null>(null);
  const [transfer, setTransfer] = useState<TransferInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [t, x] = await Promise.all([api.torrents(), api.transfer()]);
        if (cancelled) return;
        setTorrents(t);
        setTransfer(x);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || 'Failed');
      }
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-ndp-danger gap-2 px-3">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{error}</span>
      </div>
    );
  }

  if (!torrents || !transfer) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-ndp-text-dim">
        Loading…
      </div>
    );
  }

  const active = [...torrents]
    .filter((t) => t.dlspeed > 0 || t.upspeed > 0)
    .sort((a, b) => (b.dlspeed + b.upspeed) - (a.dlspeed + a.upspeed))
    .slice(0, TOP_N);

  return (
    <div className="h-full flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2 flex-shrink-0">
        <div className="rounded-xl bg-ndp-accent/10 border border-ndp-accent/20 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] text-ndp-accent font-semibold uppercase tracking-wider">
            <Download className="w-3 h-3" /> Down
          </div>
          <p className="text-base font-bold text-ndp-text mt-0.5 tabular-nums">
            {formatSpeed(transfer.dl_info_speed)}
          </p>
        </div>
        <div className="rounded-xl bg-ndp-success/10 border border-ndp-success/20 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] text-ndp-success font-semibold uppercase tracking-wider">
            <Upload className="w-3 h-3" /> Up
          </div>
          <p className="text-base font-bold text-ndp-text mt-0.5 tabular-nums">
            {formatSpeed(transfer.up_info_speed)}
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {active.length === 0 ? (
          <p className="text-xs text-ndp-text-dim italic text-center pt-4">No active transfers</p>
        ) : (
          active.map((t) => {
            const pct = Math.round(t.progress * 100);
            return (
              <div key={t.hash} className="px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-ndp-text truncate flex-1" title={t.name}>{t.name}</p>
                  <span className="text-[10px] text-ndp-text-dim tabular-nums flex-shrink-0">{pct}%</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full bg-ndp-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-ndp-text-dim tabular-nums w-16 text-right">
                    {t.dlspeed > 0 ? formatSpeed(t.dlspeed) : `↑ ${formatSpeed(t.upspeed)}`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
