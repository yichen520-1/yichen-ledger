import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useLedger } from '../../state/LedgerContext';
import { toDateKey } from '../../domain/model';
import { weekNoOf } from '../../domain/timetable';
import Schedule from '../Schedule';
import { TimetablePage } from './TimetablePage';

/**
 * 「忆笺日程」这一页里装两样东西：日程与课表。
 *
 * 为什么这两件事在同一个 App 里：
 *   它们共用同一个心智（「我什么时候要做什么」），拆成两个 App 反而
 *   会让「日程」和「课表」互相找不到。
 *
 * 但入口**不在页面右上角**。v0.7.0 时这里是两个胶囊标签，v0.7.1 挪进了
 * 侧边栏 —— 和「日程 / 设置」并排成竖排菜单项。理由：胶囊标签看起来像
 * 「筛选器」，而这两个其实是并列的两个功能页；放进导航栏，位置一直不变，
 * 人在两个 App 之间来回切也不会迷路。
 *
 * 路由：
 *   /schedule            → 日程（月 / 周 / 日视图）
 *   /schedule/timetable  → 课表
 *
 * 老地址 `#/schedule?tab=timetable` 仍然认：进来后自动 replace 到新地址，
 * 免得已经存下的书签、通知链接、旧截图脚本全部失效。
 */
export type ScheduleTab = 'schedule' | 'timetable';

export function ScheduleShell() {
  const { t } = useI18n();
  const { timetable } = useLedger();
  const location = useLocation();
  const navigate = useNavigate();

  const isTimetable = location.pathname.replace(/\/+$/, '').endsWith('/timetable');

  // 老地址兼容：#/schedule?tab=timetable → #/schedule/timetable
  useEffect(() => {
    const legacy = new URLSearchParams(location.search).get('tab');
    if (legacy === 'timetable' && !isTimetable) {
      navigate('/schedule/timetable', { replace: true });
    } else if (legacy === 'schedule' && isTimetable) {
      navigate('/schedule', { replace: true });
    }
  }, [location.search, isTimetable, navigate]);

  const today = toDateKey(new Date());
  const weekNo = weekNoOf(timetable.termStart, today);

  return (
    <div className="schedule-shell">
      <div className="page-head sched-head">
        <div>
          <h1 className="page-title">{isTimetable ? t('schedule.tabTimetable') : t('schedule.title')}</h1>
          <div className="page-sub">
            {isTimetable
              ? weekNo >= 1
                ? t('timetable.weekNo', { n: weekNo })
                : t('timetable.notStarted')
              : t('schedule.tagline')}
          </div>
        </div>
      </div>

      {isTimetable ? <TimetablePage /> : <Schedule />}
    </div>
  );
}

export default ScheduleShell;
