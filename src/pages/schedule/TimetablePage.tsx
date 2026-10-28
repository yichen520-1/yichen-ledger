import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  ImagePlus,
  MapPin,
  Plus,
  Settings2,
  Trash2,
  User,
} from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useI18n, useErrorText } from '../../i18n';
import { useLedger } from '../../state/LedgerContext';
import {
  createCourse,
  deleteCourse,
  saveTimetableMeta,
  updateCourse,
  type CourseDraft,
} from '../../db/repository';
import { toDateKey } from '../../domain/model';
import { addDays, parseDateKey, startOfWeek } from '../../domain/schedule';
import {
  clampWeek,
  COURSE_COLORS,
  courseOccurrences,
  defaultPeriods,
  findConflicts,
  isOngoing,
  periodSpan,
  totalWeeksOf,
  weekBlocks,
  weekNoOf,
  weekStartOf,
  type Course,
  type CourseSession,
  type TimetableMeta,
  type WeekParity,
} from '../../domain/timetable';
import { rescheduleCourses, COURSE_LEAD_MINUTES } from '../../state/notify';
import { TimetableOcrDialog } from './TimetableOcrDialog';

/**
 * 课表页。
 *
 * 版式：左边一列节次，右边七列星期，课是一个跨行的块 —— 和所有教务系统
 * 导出来的课表长得一样，不用重新学。
 *
 * 手机上七列放不下，所以整块可以横向滚，左侧节次列 sticky 钉住：
 * 滚到周三的时候还能看见「第几节、几点」。这比把七天折叠成手风琴好用得多 ——
 * 课表的价值恰恰在于「一眼看全一周」。
 */
export function TimetablePage() {
  const { t, dict } = useI18n();
  const toast = useToast();
  const { courses, timetable } = useLedger();

  const today = toDateKey(new Date());
  const currentWeek = weekNoOf(timetable.termStart, today);
  const [weekNo, setWeekNo] = useState(() => clampWeek(timetable, currentWeek));
  const [editing, setEditing] = useState<Course | null>(null);
  const [creating, setCreating] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  // 课表设置从库里读出来之前 currentWeek 可能是 1，等它到位了再对齐一次
  useEffect(() => {
    setWeekNo((prev) => (prev === 1 ? clampWeek(timetable, currentWeek) : prev));
    // 只在开学日期变化时重算，用户手动翻周不要被弹回来
  }, [timetable.termStart, currentWeek, timetable]);

  const blocks = useMemo(() => weekBlocks(courses, weekNo), [courses, weekNo]);
  const conflicts = useMemo(() => findConflicts(courses), [courses]);

  const periods = timetable.periods.length ? timetable.periods : defaultPeriods();
  const total = totalWeeksOf(timetable);

  /**
   * 这一周每天是几号 —— 网格表头显示「周一 10/27」，比只显示「周一」有用得多：
   * 想找「下周三交作业」的时候，眼睛扫的是日期。
   */
  const dayDates = useMemo(() => {
    const monday = weekStartOf(timetable.termStart, weekNo);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [timetable.termStart, weekNo]);

  /** 今天还有几节课（只在看本周时显示） */
  const todayOccs = useMemo(() => {
    if (weekNo !== currentWeek) return [];
    return courseOccurrences(courses, timetable, today, today).filter((o) => o.endTime >= nowHm());
  }, [courses, timetable, today, weekNo, currentWeek]);

  // 课表一变就重排提醒。只排未来 21 天，够覆盖到下一次打开 App。
  useEffect(() => {
    void rescheduleCourses(courses, timetable, 21, {
      title: (c) => c.name || t('timetable.untitled'),
      body: (o) =>
        [
          t('timetable.leadBody', { n: COURSE_LEAD_MINUTES }),
          o.startTime,
          o.course.location,
        ]
          .filter(Boolean)
          .join(' · '),
    });
  }, [courses, timetable, t]);

  const gridStyle = {
    // 一行一节；七列固定最小宽，窄屏靠横向滚动
    gridTemplateRows: `repeat(${periods.length}, minmax(46px, auto))`,
  } as React.CSSProperties;

  return (
    <div className="timetable-page">
      <div className="sched-actions">
        <button className="btn icon-btn" onClick={() => setMetaOpen(true)} aria-label={t('timetable.settings')}>
          <Settings2 size={17} />
        </button>
        <button className="btn icon-btn" onClick={() => setOcrOpen(true)} aria-label={t('timetable.ocrTitle')}>
          <ImagePlus size={17} />
        </button>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={16} />
          {t('timetable.addCourse')}
        </button>
      </div>

      <div className="card sched-toolbar">
        <div className="month-nav">
          <button
            className="btn icon-btn"
            onClick={() => setWeekNo((w) => Math.max(1, w - 1))}
            aria-label={t('schedule.prev')}
            disabled={weekNo <= 1}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="month-label"
            onClick={() => setWeekNo(clampWeek(timetable, currentWeek))}
            title={t('timetable.backToThisWeek')}
          >
            {t('timetable.weekNo', { n: weekNo })}
          </button>
          <button
            className="btn icon-btn"
            onClick={() => setWeekNo((w) => Math.min(total, w + 1))}
            aria-label={t('schedule.next')}
            disabled={weekNo >= total}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="tt-parity-legend">
          <span className="tt-legend-dot odd" /> {t('timetable.legendOdd')}
          <span className="tt-legend-dot even" /> {t('timetable.legendEven')}
        </div>
      </div>

      {todayOccs.length ? (
        <div className="card tt-today">
          <div className="tt-today-head">
            <Clock size={14} />
            {t('timetable.todayLeft', { n: todayOccs.length })}
          </div>
          <div className="tt-today-list">
            {todayOccs.map((o) => (
              <span key={o.key} className="tt-today-chip" style={{ ['--c' as string]: o.course.color }}>
                <b>{o.startTime}</b> {o.course.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {conflicts.length ? (
        <div className="card banner-warn tt-conflict">
          <div className="banner-main">
            <AlertTriangle size={16} />
            <div>
              <div className="banner-title">{t('timetable.conflictTitle', { n: conflicts.length })}</div>
              <div className="banner-body">
                {conflicts
                  .slice(0, 3)
                  .map((c) => `${c.a.name} × ${c.b.name}（${t('timetable.conflictAt', { wd: dict.weekShort[c.weekday % 7], p: c.from })}）`)
                  .join('；')}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card tt-card">
        <div className="tt-scroll">
          <div className="tt-grid" style={gridStyle}>
            {/* 表头：左上角空一格，然后是七天 */}
            <div className="tt-corner" style={{ gridColumn: 1, gridRow: 1 }} />
            {dayDates.map((d, i) => {
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className={`tt-dayhead${isToday ? ' today' : ''}`}
                  style={{ gridColumn: i + 2, gridRow: 1 }}
                >
                  <span className="wd">{dict.weekShort[parseDateKey(d).getDay()]}</span>
                  <span className="dd">
                    {parseDateKey(d).getMonth() + 1}/{parseDateKey(d).getDate()}
                  </span>
                </div>
              );
            })}

            {/* 节次列（sticky） */}
            {periods.map((p, i) => (
              <div key={p.index} className="tt-period" style={{ gridColumn: 1, gridRow: i + 2 }}>
                <b>{p.index}</b>
                <span>{p.start}</span>
              </div>
            ))}

            {/* 空网格底纹：每格一个，给「点一下就在这格加课」用 */}
            {periods.map((p, i) =>
              Array.from({ length: 7 }, (_, wd) => (
                <button
                  key={`${p.index}-${wd}`}
                  className="tt-cell"
                  style={{ gridColumn: wd + 2, gridRow: i + 2 }}
                  onClick={() => setCreating(true)}
                  aria-label={t('timetable.addCourse')}
                  tabIndex={-1}
                />
              )),
            )}

            {/* 课块 */}
            {blocks.map((b, i) => {
              const { start, end } = periodSpan(periods, b.startPeriod, b.endPeriod);
              const ongoing = weekNo === currentWeek && isOngoing(new Date(), periods, b);
              const parity = b.session.parity;
              return (
                <button
                  key={`${b.course.id}-${b.weekday}-${b.startPeriod}-${i}`}
                  className={`tt-block${ongoing ? ' ongoing' : ''}`}
                  style={{
                    gridColumn: b.weekday + 1,
                    gridRow: `${b.startPeriod + 1} / ${b.endPeriod + 2}`,
                    ['--c' as string]: b.course.color,
                  }}
                  onClick={() => setEditing(b.course)}
                  title={`${b.course.name} ${start}-${end}`}
                >
                  <span className="tt-name">{b.course.name}</span>
                  {b.course.location ? <span className="tt-loc">{b.course.location}</span> : null}
                  <span className="tt-tm">{start}</span>
                  {parity !== 'all' ? (
                    <span className={`tt-badge ${parity}`}>{parity === 'odd' ? t('timetable.odd') : t('timetable.even')}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="section-title">
        {t('timetable.allCourses', { n: courses.length })}
        <button className="btn tiny" onClick={() => setCreating(true)}>
          <Plus size={13} />
          {t('timetable.addCourse')}
        </button>
      </div>

      <div className="card stagger">
        {courses.length ? (
          courses.map((c, i) => (
            <CourseRow key={c.id} course={c} index={i} onOpen={() => setEditing(c)} periods={periods} />
          ))
        ) : (
          <div className="empty">
            <div className="emoji">📚</div>
            <div>{t('timetable.empty')}</div>
            <div className="muted tt-empty-hint">{t('timetable.emptyHint')}</div>
          </div>
        )}
      </div>

      <CourseSheet
        open={creating || !!editing}
        initial={editing}
        meta={timetable}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(mode) => {
          setCreating(false);
          setEditing(null);
          toast(mode === 'create' ? t('timetable.created') : t('timetable.saved'));
        }}
        onDeleted={() => {
          setCreating(false);
          setEditing(null);
          toast(t('timetable.deleted'));
        }}
      />

      <MetaSheet
        open={metaOpen}
        meta={timetable}
        onClose={() => setMetaOpen(false)}
        onSaved={() => {
          setMetaOpen(false);
          toast(t('timetable.saved'));
        }}
      />

      <TimetableOcrDialog
        open={ocrOpen}
        meta={timetable}
        onClose={() => setOcrOpen(false)}
        onImported={(n) => {
          setOcrOpen(false);
          toast(t('timetable.imported', { n }));
        }}
      />
    </div>
  );
}

function nowHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function CourseRow({
  course,
  index,
  onOpen,
  periods,
}: {
  course: Course;
  index: number;
  onOpen: () => void;
  periods: Array<{ index: number; start: string; end: string }>;
}) {
  const { t, dict } = useI18n();
  const sessions = course.sessions ?? [];
  return (
    <button className="tx-row tt-row" style={{ ['--i' as string]: index }} onClick={onOpen}>
      <span className="tt-swatch" style={{ background: course.color }} />
      <span className="tx-body">
        <span className="tx-title">{course.name || t('timetable.untitled')}</span>
        <span className="tx-meta">
          {sessions
            .map((s) => {
              const { start } = periodSpan(periods, s.startPeriod, s.endPeriod);
              const span = `${s.startPeriod}-${s.endPeriod}${t('timetable.periodUnit')}`;
              const week = `${s.weekFrom}-${s.weekTo}${t('timetable.weekUnit')}`;
              const parity =
                s.parity === 'odd' ? ` ${t('timetable.odd')}` : s.parity === 'even' ? ` ${t('timetable.even')}` : '';
              return `${t('timetable.weekdayShort', { wd: dict.weekShort[s.weekday % 7] })} ${span} ${start} · ${week}${parity}`;
            })
            .join('；')}
        </span>
        {course.teacher || course.location ? (
          <span className="tx-meta">
            {course.teacher ? (
              <>
                <User size={11} style={{ verticalAlign: '-1px' }} /> {course.teacher}
              </>
            ) : null}
            {course.teacher && course.location ? ' · ' : ''}
            {course.location ? (
              <>
                <MapPin size={11} style={{ verticalAlign: '-1px' }} /> {course.location}
              </>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- 课程表单 */

function CourseSheet({
  open,
  initial,
  meta,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  initial: Course | null;
  meta: TimetableMeta;
  onClose: () => void;
  onSaved: (mode: 'create' | 'update') => void;
  onDeleted: () => void;
}) {
  const { t, dict } = useI18n();
  const errorText = useErrorText();
  const toast = useToast();

  const [name, setName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [location, setLocation] = useState('');
  const [color, setColor] = useState(COURSE_COLORS[0]);
  const [note, setNote] = useState('');
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const total = totalWeeksOf(meta);
  const periods = meta.periods.length ? meta.periods : defaultPeriods();

  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded) return;
    if (initial) {
      setName(initial.name);
      setTeacher(initial.teacher);
      setLocation(initial.location);
      setColor(initial.color);
      setNote(initial.note);
      setSessions(initial.sessions?.length ? initial.sessions.map((s) => ({ ...s })) : [blankSession(total)]);
    } else {
      setName('');
      setTeacher('');
      setLocation('');
      setColor(COURSE_COLORS[0]);
      setNote('');
      setSessions([blankSession(total)]);
    }
    setSeeded(true);
  }, [open, initial, seeded, total]);

  function patch(i: number, next: Partial<CourseSession>) {
    setSessions((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...next } : s)));
  }

  async function save() {
    const draft: CourseDraft = { name, teacher, location, color, note, sessions };
    setBusy(true);
    try {
      if (initial) await updateCourse(initial.id, draft);
      else await createCourse(draft);
      onSaved(initial ? 'update' : 'create');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!window.confirm(t('timetable.deleteConfirm', { name: initial.name || t('timetable.untitled') }))) return;
    setBusy(true);
    try {
      await deleteCourse(initial.id);
      onDeleted();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={initial ? t('timetable.editSheet') : t('timetable.newSheet')}>
      <div className="field">
        <label>{t('timetable.fieldName')}</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('timetable.namePlaceholder')}
          autoFocus={!initial}
        />
      </div>

      <div className="row gap">
        <div className="field grow">
          <label>{t('timetable.fieldTeacher')}</label>
          <input className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
        </div>
        <div className="field grow">
          <label>{t('timetable.fieldLocation')}</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>{t('timetable.color')}</label>
        <div className="color-row">
          {COURSE_COLORS.map((c) => (
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
        <label>{t('timetable.sessions')}</label>
        {sessions.map((s, i) => (
          <div className="tt-session-edit" key={i}>
            <div className="row gap">
              <div className="field grow">
                <label>{t('timetable.weekday')}</label>
                <select
                  className="input"
                  value={s.weekday}
                  onChange={(e) => patch(i, { weekday: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                    <option key={wd} value={wd}>
                      {dict.weekLong[wd % 7]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field grow">
                <label>{t('timetable.periods')}</label>
                <div className="row gap tight">
                  <select
                    className="input"
                    value={s.startPeriod}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      patch(i, { startPeriod: v, endPeriod: Math.max(v, s.endPeriod) });
                    }}
                  >
                    {periods.map((p) => (
                      <option key={p.index} value={p.index}>
                        {p.index}
                      </option>
                    ))}
                  </select>
                  <span className="muted">–</span>
                  <select
                    className="input"
                    value={s.endPeriod}
                    onChange={(e) => patch(i, { endPeriod: Number(e.target.value) })}
                  >
                    {periods
                      .filter((p) => p.index >= s.startPeriod)
                      .map((p) => (
                        <option key={p.index} value={p.index}>
                          {p.index}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="row gap">
              <div className="field grow">
                <label>{t('timetable.weekRange')}</label>
                <div className="row gap tight">
                  <input
                    className="input num"
                    type="number"
                    min={1}
                    max={total}
                    value={s.weekFrom}
                    onChange={(e) => {
                      const v = clampInt(Number(e.target.value), 1, total, 1);
                      patch(i, { weekFrom: v, weekTo: Math.max(v, s.weekTo) });
                    }}
                  />
                  <span className="muted">–</span>
                  <input
                    className="input num"
                    type="number"
                    min={s.weekFrom}
                    max={total}
                    value={s.weekTo}
                    onChange={(e) => patch(i, { weekTo: clampInt(Number(e.target.value), s.weekFrom, total, total) })}
                  />
                  <span className="muted">{t('timetable.weekUnit')}</span>
                </div>
              </div>
              <div className="field grow">
                <label>{t('timetable.parity')}</label>
                <div className="segmented compact">
                  {(['all', 'odd', 'even'] as WeekParity[]).map((p) => (
                    <button key={p} className={s.parity === p ? 'on' : ''} onClick={() => patch(i, { parity: p })}>
                      {p === 'all' ? t('timetable.parityAll') : p === 'odd' ? t('timetable.odd') : t('timetable.even')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {sessions.length > 1 ? (
              <button
                className="btn tiny danger-text"
                onClick={() => setSessions((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Trash2 size={12} />
                {t('timetable.removeSession')}
              </button>
            ) : null}
          </div>
        ))}
        <button className="btn tiny" onClick={() => setSessions((prev) => [...prev, blankSession(total)])}>
          <Plus size={12} />
          {t('timetable.addSession')}
        </button>
      </div>

      <div className="field">
        <label>{t('timetable.note')}</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
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
        <button className="btn primary grow" onClick={() => void save()} disabled={busy || !name.trim()}>
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  );
}

function blankSession(total: number): CourseSession {
  return { weekday: 1, startPeriod: 1, endPeriod: 2, parity: 'all', weekFrom: 1, weekTo: Math.min(16, total) };
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/* ---------------------------------------------------------------- 课表设置 */

function MetaSheet({
  open,
  meta,
  onClose,
  onSaved,
}: {
  open: boolean;
  meta: TimetableMeta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [termStart, setTermStart] = useState(meta.termStart);
  const [totalWeeks, setTotalWeeks] = useState(meta.totalWeeks);
  const [periods, setPeriods] = useState(meta.periods);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded) return;
    setTermStart(meta.termStart);
    setTotalWeeks(meta.totalWeeks);
    setPeriods(meta.periods.length ? meta.periods.map((p) => ({ ...p })) : defaultPeriods());
    setSeeded(true);
  }, [open, meta, seeded]);

  async function save() {
    setBusy(true);
    try {
      await saveTimetableMeta({
        // 开学日一律对齐到那一周的周一：用户随手点个周三，第几周也该从周一算
        termStart: startOfWeek(termStart),
        totalWeeks: clampInt(totalWeeks, 1, 30, 20),
        periods: periods.filter((p) => /^\d{2}:\d{2}$/.test(p.start) && /^\d{2}:\d{2}$/.test(p.end)),
      });
      onSaved();
    } catch {
      toast(t('errors.unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('timetable.settingsTitle')}>
      <div className="row gap">
        <div className="field grow">
          <label>{t('timetable.termStart')}</label>
          <input className="input" type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} />
        </div>
        <div className="field grow">
          <label>{t('timetable.totalWeeks')}</label>
          <input
            className="input num"
            type="number"
            min={1}
            max={30}
            value={totalWeeks}
            onChange={(e) => setTotalWeeks(Number(e.target.value) || 20)}
          />
        </div>
      </div>

      <div className="muted tt-meta-hint">{t('timetable.termStartHint')}</div>

      <div className="field">
        <label>{t('timetable.periodsTitle')}</label>
        <div className="tt-periods">
          {periods.map((p, i) => (
            <div className="tt-period-row" key={p.index}>
              <span className="tt-period-no">{p.index}</span>
              <input
                className="input tt-time"
                type="time"
                value={p.start}
                onChange={(e) => setPeriods((prev) => prev.map((x, idx) => (idx === i ? { ...x, start: e.target.value } : x)))}
              />
              <span className="muted">–</span>
              <input
                className="input tt-time"
                type="time"
                value={p.end}
                onChange={(e) => setPeriods((prev) => prev.map((x, idx) => (idx === i ? { ...x, end: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
        <div className="row gap">
          <button className="btn tiny" onClick={() => setPeriods((prev) => [...prev, { index: prev.length + 1, start: '08:00', end: '08:45' }])}>
            <Plus size={12} />
            {t('timetable.addPeriod')}
          </button>
          <button className="btn tiny" onClick={() => setPeriods(defaultPeriods())}>
            {t('timetable.resetPeriods')}
          </button>
        </div>
      </div>

      <div className="row gap sheet-actions">
        <button className="btn grow" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button className="btn primary grow" onClick={() => void save()} disabled={busy}>
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  );
}

export default TimetablePage;
