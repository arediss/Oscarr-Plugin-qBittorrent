import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Download, Upload, Activity, AlertCircle, RefreshCw, Plus, Pause, Play, Trash2, X, CheckCircle2, Clock,
} from 'lucide-react';
import {
  api, formatBytes, formatSpeed, formatEta, STATE_LABEL,
  type Torrent, type TransferInfo, type ImportRecord,
} from './api';
import { showToast } from './toast';

const REFRESH_MS = 5000;

interface DeleteState { hashes: string[]; label: string }

type FilterId = 'all' | 'downloading' | 'seeding' | 'paused' | 'stalled' | 'imported' | 'grabbed' | 'other';

const BUILTIN_FILTERS: Array<{ id: Exclude<FilterId, 'imported'>; label: string; match: (t: Torrent) => boolean }> = [
  { id: 'all',         label: 'All',         match: () => true },
  { id: 'downloading', label: 'Downloading', match: (t) => t.state === 'downloading' || t.state === 'metaDL' },
  { id: 'seeding',     label: 'Seeding',     match: (t) => t.state === 'uploading' },
  { id: 'paused',      label: 'Paused',      match: (t) => t.state.startsWith('paused') },
  { id: 'stalled',     label: 'Stalled',     match: (t) => t.state === 'stalledDL' || t.state === 'stalledUP' },
  { id: 'other',       label: 'Other',       match: (t) => !['downloading','metaDL','uploading','stalledDL','stalledUP'].includes(t.state) && !t.state.startsWith('paused') },
];

export default function QbittorrentManager() {
  const [torrents, setTorrents] = useState<Torrent[] | null>(null);
  const [transfer, setTransfer] = useState<TransferInfo | null>(null);
  const [imports, setImports] = useState<Record<string, ImportRecord>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyHashes, setBusyHashes] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const refreshSeq = useRef(0);

  const refresh = useCallback(async (opts: { withImports?: boolean } = {}) => {
    const seq = ++refreshSeq.current;
    try {
      const tasks: [Promise<Torrent[]>, Promise<TransferInfo>, Promise<Record<string, ImportRecord>>?] = [api.torrents(), api.transfer()];
      if (opts.withImports) tasks.push(api.imports());
      const [t, x, imp] = await Promise.all(tasks);
      // Drop stale resolutions — a newer refresh has already started since this one fired.
      if (seq !== refreshSeq.current) return;
      setTorrents(t);
      setTransfer(x);
      if (imp) setImports(imp);
      setError(null);
      // Reconcile selection: drop hashes that no longer exist server-side (completed+autoremoved,
      // deleted by another admin, etc.) — otherwise they linger and skew bulk-action counts.
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const known = new Set(t.map((x) => x.hash));
        let changed = false;
        const next = new Set<string>();
        for (const h of prev) {
          if (known.has(h)) next.add(h);
          else changed = true;
        }
        return changed ? next : prev;
      });
    } catch (e) {
      if (seq !== refreshSeq.current) return;
      setError((e as Error).message || 'Failed to load qBittorrent data');
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let tickCount = 0;
    const tick = async () => {
      if (cancelled) return;
      // Imports endpoint is cached server-side 60s — refetch every 12 ticks (~60s) only.
      await refresh({ withImports: tickCount % 12 === 0 });
      tickCount++;
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [refresh]);

  const setBusy = (hashes: string[], busy: boolean) => {
    setBusyHashes((prev) => {
      const next = new Set(prev);
      for (const h of hashes) busy ? next.add(h) : next.delete(h);
      return next;
    });
  };

  const togglePause = async (t: Torrent) => {
    setBusy([t.hash], true);
    try {
      const isPaused = t.state.startsWith('paused');
      if (isPaused) await api.resume([t.hash]);
      else await api.pause([t.hash]);
      await refresh();
      showToast(isPaused ? 'Resumed' : 'Paused', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Action failed', 'error');
    } finally {
      setBusy([t.hash], false);
    }
  };

  const bulkPauseResume = async (action: 'pause' | 'resume') => {
    if (bulkBusy) return;
    const hashes = Array.from(selected);
    if (hashes.length === 0) return;
    setBulkBusy(true);
    setBusy(hashes, true);
    try {
      if (action === 'pause') await api.pause(hashes);
      else await api.resume(hashes);
      await refresh();
      setSelected(new Set());
      showToast(`${hashes.length} torrent${hashes.length > 1 ? 's' : ''} ${action}d`, 'success');
    } catch (e) {
      showToast((e as Error).message || 'Bulk action failed', 'error');
    } finally {
      setBusy(hashes, false);
      setBulkBusy(false);
    }
  };

  const counts = useMemo(() => {
    const map: Record<FilterId, number> = { all: 0, downloading: 0, seeding: 0, paused: 0, stalled: 0, imported: 0, grabbed: 0, other: 0 };
    if (!torrents) return map;
    for (const t of torrents) {
      for (const f of BUILTIN_FILTERS) if (f.match(t)) map[f.id]++;
      const rec = imports[t.hash.toLowerCase()];
      if (rec?.status === 'imported') map.imported++;
      else if (rec?.status === 'grabbed') map.grabbed++;
    }
    return map;
  }, [torrents, imports]);

  const sorted = useMemo(() => {
    if (!torrents) return [];
    const matcher: (t: Torrent) => boolean =
      filter === 'imported' ? (t) => imports[t.hash.toLowerCase()]?.status === 'imported'
      : filter === 'grabbed' ? (t) => imports[t.hash.toLowerCase()]?.status === 'grabbed'
      : BUILTIN_FILTERS.find((f) => f.id === filter)?.match ?? (() => true);
    return [...torrents]
      .filter(matcher)
      .sort((a, b) => {
        const aActive = a.dlspeed + a.upspeed;
        const bActive = b.dlspeed + b.upspeed;
        if (aActive !== bActive) return bActive - aActive;
        return b.added_on - a.added_on;
      });
  }, [torrents, filter, imports]);

  const allFilteredSelected = sorted.length > 0 && sorted.every((t) => selected.has(t.hash));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const t of sorted) next.delete(t.hash);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const t of sorted) next.add(t.hash);
        return next;
      });
    }
  };

  const toggleSelect = (hash: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(hash) ? next.delete(hash) : next.add(hash);
      return next;
    });
  };

  const stats = useMemo(() => {
    if (!torrents) return { total: 0, downloading: 0, seeding: 0 };
    return {
      total: torrents.length,
      downloading: torrents.filter((t) => t.state === 'downloading' || t.state === 'metaDL').length,
      seeding: torrents.filter((t) => t.state === 'uploading').length,
    };
  }, [torrents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Download className="w-6 h-6 text-ndp-accent" />
          <div>
            <h1 className="text-2xl font-bold text-ndp-text">qBittorrent</h1>
            <p className="text-xs text-ndp-text-dim">Live view of the configured qBittorrent instance.</p>
          </div>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn-primary flex items-center gap-2 text-sm" style={{ padding: '8px 16px' }}>
          <Plus className="w-4 h-4" />
          Add torrent
        </button>
      </div>

      {loading && !torrents && (
        <div className="card text-center text-ndp-text-dim text-sm flex items-center justify-center gap-2" style={{ padding: 48 }}>
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading qBittorrent…
        </div>
      )}

      {error && !torrents && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-ndp-danger/10 border border-ndp-danger/20 text-sm text-ndp-danger">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Couldn't reach qBittorrent</p>
            <p className="opacity-80 mt-0.5">{error}</p>
            <p className="opacity-70 text-xs mt-2">
              Add a qBittorrent service in Admin → Services and make sure the connection test passes.
            </p>
          </div>
        </div>
      )}

      {torrents && transfer && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatCard icon={<Activity className="w-4 h-4" />} label="Total" value={String(stats.total)} />
            <StatCard icon={<Download className="w-4 h-4 text-ndp-accent" />} label="Downloading" value={String(stats.downloading)} />
            <StatCard icon={<Upload className="w-4 h-4 text-ndp-success" />} label="Seeding" value={String(stats.seeding)} />
            <StatCard
              icon={<Activity className="w-4 h-4 text-ndp-accent" />}
              label="Total speed"
              value={`↓ ${formatSpeed(transfer.dl_info_speed)} · ↑ ${formatSpeed(transfer.up_info_speed)}`}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {BUILTIN_FILTERS.map(({ id, label }) => (
              <FilterPill key={id} active={filter === id} count={counts[id]} onClick={() => setFilter(id)}>{label}</FilterPill>
            ))}
            <FilterPill
              active={filter === 'imported'}
              count={counts.imported}
              onClick={() => setFilter('imported')}
              tone="success"
            >
              Imported
            </FilterPill>
            <FilterPill
              active={filter === 'grabbed'}
              count={counts.grabbed}
              onClick={() => setFilter('grabbed')}
              tone="warning"
            >
              Tracked
            </FilterPill>
          </div>

          {sorted.length === 0 ? (
            <div className="card text-center text-ndp-text-dim text-sm" style={{ padding: 48 }}>
              {torrents.length === 0 ? 'No torrents in queue' : 'No torrents match this filter'}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full text-sm" style={{ minWidth: 950 }}>
                  <thead>
                    <tr className="border-b border-white/5">
                      <th style={{ padding: '12px 16px', width: 40 }}>
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAllFiltered}
                          className="rounded border-white/10 bg-ndp-surface-light cursor-pointer"
                          aria-label="Select all"
                        />
                      </th>
                      <th className="text-left text-ndp-text-dim font-medium" style={{ padding: '12px 16px' }}>Name</th>
                      <th className="text-left text-ndp-text-dim font-medium" style={{ padding: '12px 16px', width: 200 }}>Progress</th>
                      <th className="text-right text-ndp-text-dim font-medium" style={{ padding: '12px 16px', width: 90 }}>Size</th>
                      <th className="text-right text-ndp-text-dim font-medium" style={{ padding: '12px 16px', width: 110 }}>↓ Speed</th>
                      <th className="text-right text-ndp-text-dim font-medium" style={{ padding: '12px 16px', width: 110 }}>↑ Speed</th>
                      <th className="text-right text-ndp-text-dim font-medium" style={{ padding: '12px 16px', width: 80 }}>ETA</th>
                      <th style={{ padding: '12px 16px', width: 100 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((t) => {
                      const stateInfo = STATE_LABEL[t.state] ?? { label: t.state, tone: 'text-ndp-text-dim' };
                      const pct = Math.round(t.progress * 100);
                      const isPaused = t.state.startsWith('paused');
                      const busy = busyHashes.has(t.hash);
                      const importRec = imports[t.hash.toLowerCase()];
                      const isSelected = selected.has(t.hash);
                      return (
                        <tr key={t.hash} className={`border-b border-white/5 last:border-0 transition-colors ${isSelected ? 'bg-ndp-accent/5' : 'hover:bg-white/[0.03]'}`}>
                          <td style={{ padding: '10px 16px' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(t.hash)}
                              className="rounded border-white/10 bg-ndp-surface-light cursor-pointer"
                              aria-label={`Select ${t.name}`}
                            />
                          </td>
                          <td style={{ padding: '10px 16px' }}>
                            <div className="text-ndp-text font-medium truncate max-w-md" title={t.name}>{t.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className={`text-xs ${stateInfo.tone}`}>{stateInfo.label}</span>
                              {importRec && (importRec.status === 'imported' ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-ndp-success/10 text-ndp-success"
                                  title={`Imported by ${importRec.service} on ${new Date(importRec.at).toLocaleString()}`}
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  Imported · {importRec.service}
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400"
                                  title={`Grabbed by ${importRec.service} on ${new Date(importRec.at).toLocaleString()} — not yet imported`}
                                >
                                  <Clock className="w-3 h-3" />
                                  Tracked · {importRec.service}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '10px 16px' }}>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                <div className="h-full bg-ndp-accent transition-all duration-500" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-ndp-text-dim tabular-nums w-9 text-right">{pct}%</span>
                            </div>
                          </td>
                          <td className="text-right tabular-nums text-ndp-text-dim" style={{ padding: '10px 16px' }}>{formatBytes(t.size)}</td>
                          <td className="text-right tabular-nums text-ndp-text" style={{ padding: '10px 16px' }}>
                            {t.dlspeed > 0 ? formatSpeed(t.dlspeed) : <span className="text-ndp-text-dim">—</span>}
                          </td>
                          <td className="text-right tabular-nums text-ndp-text" style={{ padding: '10px 16px' }}>
                            {t.upspeed > 0 ? formatSpeed(t.upspeed) : <span className="text-ndp-text-dim">—</span>}
                          </td>
                          <td className="text-right tabular-nums text-ndp-text-dim" style={{ padding: '10px 16px' }}>
                            {t.dlspeed > 0 ? formatEta(t.eta) : '—'}
                          </td>
                          <td className="text-right" style={{ padding: '10px 16px' }}>
                            <div className="flex items-center justify-end gap-1">
                              <RowAction onClick={() => togglePause(t)} disabled={busy} title={isPaused ? 'Resume' : 'Pause'} tone="muted">
                                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                              </RowAction>
                              <RowAction onClick={() => setDeleteState({ hashes: [t.hash], label: t.name })} disabled={busy} title="Delete" tone="danger">
                                <Trash2 className="w-3.5 h-3.5" />
                              </RowAction>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <BulkBar
        count={selected.size}
        busy={bulkBusy}
        onPause={() => bulkPauseResume('pause')}
        onResume={() => bulkPauseResume('resume')}
        onDelete={() => setDeleteState({ hashes: Array.from(selected), label: `${selected.size} torrents` })}
        onClear={() => setSelected(new Set())}
      />

      {addOpen && (
        <AddMagnetModal
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); refresh(); showToast('Torrent added', 'success'); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}

      {deleteState && (
        <DeleteConfirmModal
          label={deleteState.label}
          count={deleteState.hashes.length}
          onClose={() => setDeleteState(null)}
          onConfirm={async (deleteFiles) => {
            try {
              await api.remove(deleteState.hashes, deleteFiles);
              const verb = deleteState.hashes.length > 1 ? `${deleteState.hashes.length} torrents` : 'Torrent';
              showToast(deleteFiles ? `${verb} + files deleted` : `${verb} removed`, 'success');
              setSelected((prev) => {
                const next = new Set(prev);
                for (const h of deleteState.hashes) next.delete(h);
                return next;
              });
              setDeleteState(null);
              await refresh();
            } catch (e) {
              showToast((e as Error).message || 'Delete failed', 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="flex items-center gap-2 text-xs text-ndp-text-dim">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-lg font-semibold text-ndp-text mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function FilterPill({
  active, count, onClick, children, tone,
}: {
  active: boolean; count: number; onClick: () => void; children: React.ReactNode; tone?: 'success' | 'warning';
}) {
  const base = 'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap';
  const activeCls = tone === 'success' ? 'bg-ndp-success text-white'
    : tone === 'warning' ? 'bg-amber-500 text-white'
    : 'bg-ndp-accent text-white';
  const cls = active ? activeCls : 'bg-ndp-surface text-ndp-text-muted hover:bg-ndp-surface-light';
  return (
    <button onClick={onClick} className={`${base} ${cls}`}>
      <span>{children}</span>
      <span className={`text-xs tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>{count}</span>
    </button>
  );
}

function BulkBar({
  count, busy, onPause, onResume, onDelete, onClear,
}: {
  count: number;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const visible = count > 0;
  return (
    <div className={`fixed bottom-0 left-0 right-0 z-40 transition-all duration-300 ease-out ${
      visible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
    }`}>
      <div className="max-w-4xl mx-auto px-4 pb-4">
        <div className="flex items-center justify-between gap-4 px-5 py-3 rounded-2xl border border-white/10 bg-ndp-surface/95 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <span className="text-sm text-ndp-text font-medium">
            {count} selected
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onPause} disabled={busy} className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50" style={{ padding: '6px 12px' }}>
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
            <button onClick={onResume} disabled={busy} className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50" style={{ padding: '6px 12px' }}>
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
            <button onClick={onDelete} disabled={busy} className="btn-danger flex items-center gap-1.5 text-sm disabled:opacity-50" style={{ padding: '6px 12px' }}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button onClick={onClear} disabled={busy} className="text-xs text-ndp-text-dim hover:text-ndp-text px-2 py-1 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50">
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RowAction({
  children, onClick, disabled, title, tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  tone: 'muted' | 'danger';
}) {
  const toneCls = tone === 'danger'
    ? 'text-ndp-text-dim hover:text-ndp-danger hover:bg-ndp-danger/10'
    : 'text-ndp-text-dim hover:text-ndp-text hover:bg-white/5';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneCls}`}
    >
      {children}
    </button>
  );
}

function AddMagnetModal({
  onClose, onAdded, onError,
}: {
  onClose: () => void;
  onAdded: () => void;
  onError: (msg: string) => void;
}) {
  const [magnet, setMagnet] = useState('');
  const [category, setCategory] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = magnet.trim();
    if (!/^magnet:\?/i.test(trimmed)) {
      onError('Magnet URL must start with magnet:?');
      return;
    }
    setSubmitting(true);
    try {
      await api.addMagnet(trimmed, category.trim() || undefined);
      onAdded();
    } catch (e) {
      onError((e as Error).message || 'Add failed');
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Add torrent" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-ndp-text-dim">Magnet URL</span>
          <textarea
            value={magnet}
            onChange={(e) => setMagnet(e.target.value)}
            rows={4}
            placeholder="magnet:?xt=urn:btih:…"
            className="input mt-1 w-full font-mono text-xs"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-xs text-ndp-text-dim">Category (optional)</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="movies, tv, …"
            className="input mt-1 w-full text-sm"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6">
        <button onClick={onClose} className="btn-secondary text-sm" style={{ padding: '8px 16px' }} disabled={submitting}>
          Cancel
        </button>
        <button onClick={submit} className="btn-primary text-sm" style={{ padding: '8px 16px' }} disabled={submitting || !magnet.trim()}>
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </ModalShell>
  );
}

function DeleteConfirmModal({
  label, count, onClose, onConfirm,
}: {
  label: string;
  count: number;
  onClose: () => void;
  onConfirm: (deleteFiles: boolean) => Promise<void>;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    setSubmitting(true);
    await onConfirm(deleteFiles);
    setSubmitting(false);
  };

  const isBulk = count > 1;

  return (
    <ModalShell title={isBulk ? `Delete ${count} torrents` : 'Delete torrent'} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ndp-text">
          {isBulk
            ? `Remove these ${count} torrents from qBittorrent?`
            : 'Remove this torrent from qBittorrent?'}
        </p>
        {!isBulk && (
          <p className="text-xs text-ndp-text-dim font-mono break-all px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
            {label}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-ndp-text cursor-pointer select-none">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="rounded border-white/10 bg-ndp-surface-light"
          />
          <span>Also delete the downloaded files from disk</span>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6">
        <button onClick={onClose} className="btn-secondary text-sm" style={{ padding: '8px 16px' }} disabled={submitting}>
          Cancel
        </button>
        <button onClick={confirm} className="btn-danger text-sm" style={{ padding: '8px 16px' }} disabled={submitting}>
          {submitting ? 'Deleting…' : (deleteFiles ? 'Delete + remove files' : 'Delete')}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md shadow-2xl shadow-black/60" onClick={(e) => e.stopPropagation()} style={{ overflow: 'visible' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-base font-semibold text-ndp-text">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
