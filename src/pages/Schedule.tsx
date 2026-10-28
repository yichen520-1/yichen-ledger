import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  MapPin,
  Plus,
  Repeat,
  Search,
  Trash2,
} from 'lucide-react';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useI18n, useErrorText } from '../i18n';
import { useLedger } from '../state/LedgerContext';
import {
  createEvent,
  deleteEvent,
  toggleEventDone,
  updateEvent,
  type EventDraft,
} from '../db/repository';
import {
  addDays,
  countByDate,
  EVENT_COLORS,
  expandRange,
  monthGrid,
  parseDateKey,
  REMINDER_CHOICES,
  weekDays,
  type EventItem,
  type Occurrence,
  type RecurFreq,
  type Recurrence,
} from '../domain/schedule';
import { toDateKey } from '../domain/model';
import { rescheduleAll, ensureNotifyPermission, notifySupport } from '../state/notify';
import { OcrDialog } from './schedule/OcrDialog';

type View = 'month' | 'week' | 'day';

const todayKey = () => toDateKey(new Date());
const monthKeyOf = (d: string) => d.slice(0, 7);

export function Schedule() {
  const { t, dict, lang } = useI18n();
  const toast = useToast();
  const { events } = useLedger();

  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(todayKey());
  const [selected, setSelected] = useState(todayKey());
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [ocrOpen, setOcrOpen] = useState(false);
  const [notifyState, setNotifyState] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>(
    'unknown',
  );

  const support = useMemo(() => notifySupport(), []);

  // 每次日程变化就重排提醒（只排未来 30 天）
  useEffect(() => {
    void rescheduleAll(events, 30, {
      title: (ev) => ev.title || t('schedule.untitled'),
      body: (ev, date) => (ev.location ? `${date} · ${ev.location}` : date),
    });
  }, [events, t]);

  const month = monthKeyOf(cursor);
  const grid = useMemo(() => monthGrid(month), [month]);
  const rangeOccs = useMemo(() => {
    if (view === 'month') return expandRange(events, grid[0], grid[grid.length - 1]);
    if (view === 'week') {
      const days = weekDays(cursor);
      return expandRange(events, days[0], days[6]);
    }
    return expandRange(events, cursor, cursor);
  }, [events, view, grid, cursor]);

  const byDate = useMemo(() => countByDate(rangeOccs), [rangeOccs]);

  const dayOccs = useMemo(
    () => expandRange(events, selected, selected),
    [events, selected],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hit = events.filter((ev) =>
      [ev.title, ev.notes, ev.location, ev.tag].some((s) => (s ?? '').toLowerCase().includes(q)),
    );
    return expandRange(hit, addDays(todayKey(), -180), addDays(todayKey(), 365));
  }, [events, query]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    if (lang === 'en') {
      const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return `${M[m - 1]} ${y}`;
    }
    if (lang === 'ja') return `${y}年${m}月`;
    return `${y} 年 ${m} 月`;
  }, [month, lang]);

  const titleOf = (ev: EventItem) => ev.title || t('schedule.untitled');

  function shift(dir: number) {
    if (view === 'month') {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      setCursor(next);
      setSelected(next);
    } else if (view === 'week') {
      const next = addDays(cursor, dir * 7);
      setCursor(next);
      setSelected(next);
    } else {
      const next = addDays(cursor, dir);
      setCursor(next);
      setSelected(next);
    }
  }

  function jumpToday() {
    const k = todayKey();
    setCursor(k);
    setSelected(k);
  }

  async function onEnableNotify() {
    const ok = await ensureNotifyPermission();
    setNotifyState(ok ? 'granted' : 'denied');
    if (ok) {
      await rescheduleAll(events, 30, {
        title: (ev) => ev.title || t('schedule.untitled'),
        body: (ev, date) => (ev.location ? `${date} · ${ev.location}` : date),
      });
      toast(t('schedule.notifyGranted'));
    } else {
      toast(t('schedule.notifyDenied'));
    }
  }

  const dayListTitle = useMemo(() => {
    const d = parseDateKey(selected);
    if (lang === 'en') {
      const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${M[d.getMonth()]} ${d.getDate()} · ${dict.weekLong[d.getDay()]}`;
    }
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${dict.weekLong[d.getDay()]}`;
  }, [selected, lang, dict]);

  return (
    <div className="schedule-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('schedule.title')}</h1>
          <div className="page-sub">{t('schedule.sub', { month: monthLabel, n: rangeOccs.length })}</div>
        </div>
        <div className="page-actions">
          <button className="btn icon-btn" onClick={() => setSearching((v) => !v)} aria-label={t('schedule.search')}>
            <Search size={17} />
          </button>
          <button className="btn icon-btn" onClick={() => setOcrOpen(true)} aria-label={t('schedule.ocrTitle')}>
            <ImagePlus size={17} />
          </button>
          <button className="btn primary" onClick={() => setCreating(selected)}>
            <Plus size={16} />
            {t('schedule.newEvent')}
          </button>
        </div>
      </div>

      {searching ? (
        <div className="card search-box">
          <input
            className="input"
            autoFocus
            value={query}
            placeholder={t('schedule.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() ? (
            searchResults.length ? (
              <div className="tx-list">
                {searchResults.slice(0, 60).map((o) => (
                  <OccurrenceRow
                    key={o.key}
                    occ={o}
                    onOpen={() => setEditing(o.event)}
                    onToggle={() => void toggleEventDone(o.event, o.date)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">{t('schedule.searchEmpty')}</div>
            )
          ) : null}
        </div>
      ) : null}

      <div className="card sched-toolbar">
        <div className="month-nav">
          <button className="btn icon-btn" onClick={() => shift(-1)} aria-label={t('schedule.prev')}>
            <ChevronLeft size={17} />
          </button>
          <button className="month-label" onClick={jumpToday} title={t('schedule.today')}>
            {monthLabel}
          </button>
          <button className="btn icon-btn" onClick={() => shift(1)} aria-label={t('schedule.next')}>
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="segmented compact">
          {(['month', 'week', 'day'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'month' ? t('schedule.viewMonth') : v === 'week' ? t('schedule.viewWeek') : t('schedule.viewDay')}
            </button>
          ))}
        </div>
      </div>

      {support !== 'unsupported' && notifyState !== 'granted' ? (
        <div className="card banner-info">
          <div className="banner-main">
            <Bell size={16} />
            <div>
              <div className="banner-title">{t('schedule.notifyTitle')}</div>
              <div className="banner-body">
                {support === 'web' ? t('schedule.notifyWebLimit') : t('schedule.notifyBody')}
              </div>
            </div>
          </div>
          <button className="btn tiny" onClick={() => void onEnableNotify()}>
            {t('schedule.notifyEnable')}
          </button>
        </div>
      ) : null}

      {view === 'month' ? (
        <div className="card sched-month">
          <div className="sched-weekhead">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="sched-wd">
                {dict.weekShort[(i + 1) % 7]}
              </div>
            ))}
          </div>
          <div className="sched-grid">
            {grid.map((d) => {
              const inMonth = monthKeyOf(d) === month;
              const isToday = d === todayKey();
              const isSel = d === selected;
              const n = byDate.get(d) ?? 0;
              return (
                <button
                  key={d}
                  className={`sched-cell${inMonth ? '' : ' out'}${isToday ? ' today' : ''}${isSel ? ' sel' : ''}`}
                  onClick={() => {
                    setSelected(d);
                    setCursor(d);
                  }}
                  onDoubleClick={() => setCreating(d)}
                >
                  <span className="d">{parseDateKey(d).getDate()}</span>
                  {n > 0 ? (
                    <span className="dots">
                      {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === 'week' ? (
        <div className="card sched-week">
          {weekDays(cursor).map((d) => {
            const list = rangeOccs.filter((o) => o.date === d);
            const isToday = d === todayKey();
            return (
              <div key={d} className={`sched-weekcol${isToday ? ' today' : ''}`}>
                <button className="sched-weekday" onClick={() => { setSelected(d); setView('day'); }}>
                  <span className="wd">{dict.weekShort[parseDateKey(d).getDay()]}</span>
                  <span className="dd">{parseDateKey(d).getDate()}</span>
                </button>
                <div className="sched-weeklist">
                  {list.length ? (
                    list.map((o) => (
                      <button
                        key={o.key}
                        className={`sched-chip${o.done ? ' done' : ''}`}
                        style={{ borderLeftColor: o.event.color }}
                        onClick={() => setEditing(o.event)}
                      >
                        <span className="tm">{o.event.allDay ? t('schedule.allDayLabel') : o.event.startTime}</span>
                        <span className="tt">{titleOf(o.event)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="sched-blank">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {view === 'day' ? <div className="sched-dayhead">{dayListTitle}</div> : null}

      <div className="section-title">
        {view === 'day' ? t('schedule.viewDay') : dayListTitle}
        <button className="btn tiny" onClick={() => setCreating(selected)}>
          <Plus size={13} />
          {t('schedule.newEvent')}
        </button>
      </div>

      <div className="card stagger">
        {dayOccs.length ? (
          dayOccs.map((o, i) => (
            <OccurrenceRow
              key={o.key}
              occ={o}
              index={i}
              onOpen={() => setEditing(o.event)}
              onToggle={() => void toggleEventDone(o.event, o.date)}
            />
          ))
        ) : (
          <div className="empty">
            <div className="emoji">🗓️</div>
            <div>{t('schedule.empty')}</div>
            <div className="muted" style={{ marginTop: 6, fontSize: 'calc(12.5px * var(--font-scale, 1))' }}>
              {t('schedule.emptyHint')}
            </div>
          </div>
        )}
      </div>

      <EventSheet
        open={!!creating || !!editing}
        initial={editing}
        defaultDate={creating ?? selected}
        onClose={() => {
          setCreating(null);
          setEditing(null);
        }}
        onSaved={(mode) => {
          setCreating(null);
          setEditing(null);
          toast(mode === 'create' ? t('schedule.created') : t('schedule.saved'));
        }}
        onDeleted={() => {
          setCreating(null);
          setEditing(null);
          toast(t('schedule.deleted'));
        }}
      />

      <OcrDialog
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onImported={(n) => {
          setOcrOpen(false);
          toast(t('schedule.ocrFound', { n }));
        }}
      />
    </div>
  );
}

function OccurrenceRow({
  occ,
  index = 0,
  onOpen,
  onToggle,
}: {
  occ: Occurrence;
  index?: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const ev = occ.event;
  return (
    <div className={`tx-row sched-row${occ.done ? ' done' : ''}`} style={{ ['--i' as string]: index }}>
      <button className="sched-check" onClick={onToggle} aria-label={occ.done ? t('schedule.undone') : t('schedule.done')}>
        {occ.done ? <Check size={13} /> : null}
      </button>
      <div className="tx-icon" style={{ background: `${ev.color}22`, color: ev.color }}>
        <CalendarDays size={16} />
      </div>
      <button className="tx-body sched-open" onClick={onOpen}>
        <div className="tx-title">{ev.title || t('schedule.untitled')}</div>
        <div className="tx-meta">
          {ev.allDay ? t('schedule.allDayLabel') : `${ev.startTime} – ${ev.endTime}`}
          {ev.location ? (
            <>
              {' · '}
              <MapPin size={11} style={{ verticalAlign: '-1px' }} /> {ev.location}
            </>
          ) : null}
          {ev.recurrence?.freq !== 'none' ? (
            <>
              {' · '}
              <Repeat size={11} style={{ verticalAlign: '-1px' }} />
            </>
          ) : null}
          {ev.tag ? ` · ${ev.tag}` : ''}
        </div>
      </button>
      <span className="sched-date">{occ.date.slice(5).replace('-', '/')}</span>
    </div>
  );
}

function EventSheet({
  open,
  initial,
  defaultDate,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  initial: EventItem | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (mode: 'create' | 'update') => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState(EVENT_COLORS[0]);
  const [tag, setTag] = useState('');
  const [freq, setFreq] = useState<RecurFreq>('none');
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState('');
  const [reminders, setReminders] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded) return;
    if (initial) {
      setTitle(initial.title);
      setNotes(initial.notes);
      setLocation(initial.location);
      setDate(initial.date);
      setStartTime(initial.startTime);
      setEndTime(initial.endTime);
      setAllDay(initial.allDay);
      setColor(initial.color);
      setTag(initial.tag);
      setFreq(initial.recurrence?.freq ?? 'none');
      setInterval(initial.recurrence?.interval ?? 1);
      setWeekdays(initial.recurrence?.weekdays ?? []);
      setUntil(initial.recurrence?.until ?? '');
      setReminders(initial.reminders ?? []);
    } else {
      setTitle('');
      setNotes('');
      setLocation('');
      setDate(defaultDate);
      setStartTime('09:00');
      setEndTime('10:00');
      setAllDay(false);
      setColor(EVENT_COLORS[0]);
      setTag('');
      setFreq('none');
      setInterval(1);
      setWeekdays([]);
      setUntil('');
      setReminders([]);
    }
    setSeeded(true);
  }, [open, initial, defaultDate, seeded]);

  const draft: EventDraft = {
    title,
    notes,
    location,
    date,
    startTime,
    endTime,
    allDay,
    color,
    tag,
    recurrence: {
      freq,
      interval: Math.max(1, interval),
      weekdays,
      until: until || null,
    } as Recurrence,
    reminders,
  };

  async function save() {
    setBusy(true);
    try {
      if (initial) await updateEvent(initial.id, draft);
      else await createEvent(draft);
      onSaved(initial ? 'update' : 'create');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial) return;
    // 重复日程删的是整串，得说清楚，别让人以为只删这一次
    const recurring = initial.recurrence.freq !== 'none';
    const key = recurring ? 'schedule.deleteConfirmSeries' : 'schedule.deleteConfirm';
    if (!window.confirm(t(key, { title: initial.title || t('schedule.untitled') }))) return;
    setBusy(true);
    try {
      await deleteEvent(initial.id);
      onDeleted();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={initial ? t('schedule.editSheet') : t('schedule.newSheet')}>
      <div className="field">
        <label>{t('schedule.fieldTitle')}</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('schedule.titlePlaceholder')} />
      </div>

      <div className="field">
        <label>{t('schedule.date')}</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>{t('schedule.allDay')}</label>
        <input className="switch" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
      </div>

      {!allDay ? (
        <div className="row gap">
          <div className="field grow">
            <label>{t('schedule.startTime')}</label>
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="field grow">
            <label>{t('schedule.endTime')}</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
      ) : null}

      <div className="field">
        <label>{t('schedule.location')}</label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>

      <div className="field">
        <label>{t('schedule.tag')}</label>
        <input className="input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t('schedule.tagPlaceholder')} />
      </div>

      <div className="field">
        <label>{t('schedule.notes')}</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="field">
        <label>{t('schedule.color')}</label>
        <div className="color-row">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              className={`color-chip${color === c ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t('schedule.repeat')}</label>
        <select
          className="input"
          value={freq}
          onChange={(e) => setFreq(e.target.value as RecurFreq)}
        >
          <option value="none">{t('schedule.repeatNone')}</option>
          <option value="daily">{t('schedule.repeatDaily')}</option>
          <option value="weekly">{t('schedule.repeatWeekly')}</option>
          <option value="monthly">{t('schedule.repeatMonthly')}</option>
          <option value="yearly">{t('schedule.repeatYearly')}</option>
        </select>
      </div>

      {freq !== 'none' ? (
        <>
          <div className="field">
            <label>{t('schedule.repeatEvery')}</label>
            <div className="row gap">
              <input
                className="input num"
                type="number"
                min={1}
                max={99}
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value) || 1)}
              />
              <span className="muted">
                {freq === 'daily'
                  ? t('schedule.repeatUnitDay')
                  : freq === 'weekly'
                    ? t('schedule.repeatUnitWeek')
                    : freq === 'monthly'
                      ? t('schedule.repeatUnitMonth')
                      : t('schedule.repeatUnitYear')}
              </span>
            </div>
          </div>

          {freq === 'weekly' ? (
            <div className="field">
              <label>{t('schedule.repeatWeekdays')}</label>
              <div className="wd-row">
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                  <button
                    key={wd}
                    className={`wd-chip${weekdays.includes(wd) ? ' on' : ''}`}
                    onClick={() =>
                      setWeekdays((prev) => (prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd]))
                    }
                  >
                    {['日', '一', '二', '三', '四', '五', '六'][wd]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="field">
            <label>{t('schedule.repeatUntil')}</label>
            <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        </>
      ) : null}

      <div className="field">
        <label>{t('schedule.reminders')}</label>
        <div className="chip-wrap">
          {REMINDER_CHOICES.map((m) => (
            <button
              key={m}
              className={`chip${reminders.includes(m) ? ' on' : ''}`}
              onClick={() =>
                setReminders((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
              }
            >
              {m === 0
                ? t('schedule.reminderAtTime')
                : m >= 60
                  ? t('schedule.reminderBefore', { n: `${m / 60}${t('schedule.unitHour')}` })
                  : t('schedule.reminderBefore', { n: `${m}${t('schedule.unitMinute')}` })}
            </button>
          ))}
        </div>
      </div>

      <div className="row gap sheet-actions">
        {initial ? (
          <button className="btn danger" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={15} />
          </button>
        ) : null}
        <button className="btn grow" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button className="btn primary grow" onClick={() => void save()} disabled={busy || !title.trim()}>
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  );
}

export default Schedule;
