import { useMemo, useState } from 'react';
import { CalendarDays, Grid3x3 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useLedger } from '../../state/LedgerContext';
import { toDateKey } from '../../domain/model';
import { weekNoOf } from '../../domain/timetable';
import Schedule from '../Schedule';
import { TimetablePage } from './TimetablePage';

/**
 * 「忆尘日程」这一页里装两样东西：日程与课表。
 *
 * 为什么做成两个标签页而不是两个侧边栏入口：
 *   这两件事共用同一个心智（「我什么时候要做什么」），顶上那个标签位置
 *   一直不变，人不会迷路；拆成两个入口反而像两个互不相干的 App。
 *
 * 课表用 ?tab=timetable 记在地址栏里，刷新 / 从通知点回来都还在课表上。
 */
export type ScheduleTab = 'schedule' | 'timetable';

function readTab(): ScheduleTab {
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get('tab') === 'timetable' ? 'timetable' : 'schedule';
}

export function ScheduleShell() {
  const { t } = useI18n();
  const { timetable } = useLedger();
  const [tab, setTab] = useState<ScheduleTab>(readTab);

  const today = toDateKey(new Date());
  const weekNo = useMemo(() => weekNoOf(timetable.termStart, today), [timetable.termStart, today]);

  function pick(next: ScheduleTab) {
    setTab(next);
    // 用 replaceState 而不是 navigate：这里只换一个页内标签，
    // 不该在浏览器历史里堆一层（否则「返回」要按两次才回到上一页）。
    window.history.replaceState(null, null as unknown as string, next === 'timetable' ? '#/schedule?tab=timetable' : '#/schedule');
  }

  return (
    <div className="schedule-shell">
      <div className="page-head sched-head">
        <div>
          <h1 className="page-title">{t('schedule.title')}</h1>
          <div className="page-sub">
            {tab === 'timetable'
              ? weekNo >= 1
                ? t('timetable.weekNo', { n: weekNo })
                : t('timetable.notStarted')
              : t('schedule.tagline')}
          </div>
        </div>
        <div className="sched-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'schedule'}
            className={`sched-tab${tab === 'schedule' ? ' on' : ''}`}
            onClick={() => pick('schedule')}
          >
            <CalendarDays size={15} />
            {t('schedule.tabSchedule')}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'timetable'}
            className={`sched-tab${tab === 'timetable' ? ' on' : ''}`}
            onClick={() => pick('timetable')}
          >
            <Grid3x3 size={15} />
            {t('schedule.tabTimetable')}
          </button>
        </div>
      </div>

      {tab === 'schedule' ? <Schedule /> : <TimetablePage />}
    </div>
  );
}

export default ScheduleShell;
