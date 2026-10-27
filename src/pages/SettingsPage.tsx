import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Download, Upload } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { exportBackup, exportCsvText, importBackup, importCsvText } from '../db/repository';

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 稍后释放，避免部分 WebView 里下载被取消
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function SettingsPage() {
  const { accounts, transactions, categories, budgets } = useLedger();
  const toast = useToast();
  const backupInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function doExportBackup() {
    const text = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`忆尘记账备份-${stamp}.json`, text, 'application/json');
    toast('备份文件已生成');
  }

  async function doExportCsv() {
    const text = await exportCsvText();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`忆尘记账-${stamp}.csv`, text, 'text/csv;charset=utf-8');
    toast('CSV 已生成，可用 Excel 打开');
  }

  async function onBackupFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('导入备份会覆盖当前全部数据，确定继续吗？')) return;
    setBusy(true);
    try {
      await importBackup(await file.text());
      toast('备份已恢复');
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  async function onCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const result = await importCsvText(await file.text());
      toast(`导入 ${result.imported} 条，跳过 ${result.skipped} 条`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  function wipe() {
    if (!window.confirm('清空所有账目、账户和预算？此操作不可撤销，建议先导出备份。')) return;
    if (!window.confirm('真的要清空吗？')) return;
    indexedDB.deleteDatabase('yichen-ledger');
    window.location.reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">我的</h1>
          <div className="page-sub">数据、外观与关于</div>
        </div>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 16 }}>
          <div className="grow">
            <div className="muted">账目</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{transactions.length}</div>
          </div>
          <div className="grow">
            <div className="muted">账户</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{accounts.length}</div>
          </div>
          <div className="grow">
            <div className="muted">分类</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{categories.length}</div>
          </div>
          <div className="grow">
            <div className="muted">预算</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{budgets.length}</div>
          </div>
        </div>
      </section>

      <div className="section-title">管理</div>
      <section className="card" style={{ padding: '4px 14px' }}>
        <Link to="/accounts" className="tx-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tx-icon">🏦</div>
          <div className="tx-body">
            <div className="tx-title">账户管理</div>
            <div className="tx-meta">现金、银行卡、信用卡、投资</div>
          </div>
          <ChevronRight size={16} color="var(--text-faint)" />
        </Link>
        <Link to="/categories" className="tx-row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tx-icon">🏷️</div>
          <div className="tx-body">
            <div className="tx-title">分类管理</div>
            <div className="tx-meta">自定义图标与颜色</div>
          </div>
          <ChevronRight size={16} color="var(--text-faint)" />
        </Link>
      </section>

      <div className="section-title">数据备份</div>
      <section className="card">
        <div className="privacy-line">数据只存在你自己的设备上</div>
        <div className="muted" style={{ marginBottom: 12 }}>
          所有数据都存在这台设备的 IndexedDB 里，不上传任何服务器。换设备时用「完整备份」搬家。
        </div>
        <button className="btn block" style={{ marginBottom: 8 }} onClick={doExportBackup} disabled={busy}>
          <Download size={15} />
          导出完整备份（JSON）
        </button>
        <button className="btn block" style={{ marginBottom: 8 }} onClick={doExportCsv} disabled={busy}>
          <Download size={15} />
          导出表格（CSV / Excel）
        </button>
        <button className="btn block" style={{ marginBottom: 8 }} onClick={() => backupInput.current?.click()} disabled={busy}>
          <Upload size={15} />
          从备份恢复（覆盖）
        </button>
        <button className="btn block" onClick={() => csvInput.current?.click()} disabled={busy}>
          <Upload size={15} />
          导入 CSV（追加）
        </button>
        <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={onBackupFile} />
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
      </section>

      <div className="section-title">危险操作</div>
      <section className="card">
        <button className="btn danger block" onClick={wipe}>
          清空全部数据
        </button>
      </section>

      <div className="section-title">关于</div>
      <section className="card">
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="brand-mark">忆</div>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>忆尘记账 v{__APP_VERSION__}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              本地优先的个人记账应用，同一套代码运行在 Android、iOS、Windows 和 macOS 上。
              所有金额以「分」为整数存储，不会有小数误差。
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
