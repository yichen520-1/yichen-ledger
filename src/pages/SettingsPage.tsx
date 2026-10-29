import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  Image as ImageIcon,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n, useErrorText, type LangSetting } from '../i18n';
import { useToast } from '../components/Toast';
import {
  REGIONS,
  readImageAsDataUrl,
  useAppearance,
  type FitMode,
  type FontStyle,
  type RegionKey,
  type ThemeMode,
} from '../state/AppearanceContext';
import { exportBackup, exportCsvText, importBackup, importCsvText } from '../db/repository';
import { db } from '../db';
import { PROVIDER_PRESETS, useAiConfig, type AiConfig, type AiProvider } from '../state/ai';

/**
 * 设置中心
 * ------------------------------------------------------------------
 * 四组：通用 / 外观 / 数据 / 关于。
 * 每一项都是「改了立刻生效并写库」，不需要点保存——这是移动端设置页的通行做法，
 * 少一次点击，也少一个「忘了点保存」的坑。
 */

type Startup = 'dashboard' | 'stats' | 'budgets';

const STARTUP_KEY = 'ui.startup';

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

/** 一行设置：左边说明，右边控件 */
function Row({ name, hint, children }: { name: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-main">
        <div className="set-name">{name}</div>
        {hint ? <div className="set-hint">{hint}</div> : null}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

/** 滑杆：数值实时显示，拖动时整站跟着变 */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span>{label}</span>
        <span className="mono">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { accounts, transactions, categories, budgets } = useLedger();
  const toast = useToast();
  const { t, lang, setting, setLang } = useI18n();
  const errorText = useErrorText();
  const { appearance, patch, patchRegion, resetRegion, resetAll, copyToAll } = useAppearance();

  const backupInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const wallpaperInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState<RegionKey>('main');
  const [startup, setStartup] = useState<Startup>('dashboard');

  // 深浅主题的三个选项。标签走 t()，所以放在组件里算。
  const THEMES: Array<[ThemeMode, string]> = [
    ['system', t('settings.themeSystem')],
    ['dark', t('settings.themeDark')],
    ['light', t('settings.themeLight')],
  ];

  // AI 设置：读一次填进表单，改完点保存才写库
  const { config, save: saveAiConfig } = useAiConfig();
  const [ai, setAi] = useState<AiConfig>(config);
  const aiSeeded = useRef(false);
  useEffect(() => {
    if (aiSeeded.current) return;
    if (config.apiKey || config.baseUrl) {
      setAi(config);
      aiSeeded.current = true;
    }
  }, [config]);
  const saveAi = async (next: AiConfig) => {
    setAi(next);
    await saveAiConfig(next);
  };

  // 启动页是独立的小设置，读一次即可
  useEffect(() => {
    let alive = true;
    db.settings
      .get(STARTUP_KEY)
      .then((row) => {
        if (!alive || typeof row?.value !== 'string') return;
        if (row.value === 'dashboard' || row.value === 'stats' || row.value === 'budgets') {
          setStartup(row.value);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function changeStartup(v: Startup) {
    setStartup(v);
    db.settings.put({ key: STARTUP_KEY, value: v }).catch(() => undefined);
  }

  async function doExportBackup() {
    const text = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`忆笺-记账备份-${stamp}.json`, text, 'application/json');
    toast(t('settings.backupDone'));
  }

  async function doExportCsv() {
    const text = await exportCsvText();
    const stamp = new Date().toISOString().slice(0, 10);
    download(`忆笺-记账-${stamp}.csv`, text, 'text/csv;charset=utf-8');
    toast(t('settings.csvDone'));
  }

  async function onBackupFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(t('settings.confirmImport'))) return;
    setBusy(true);
    try {
      await importBackup(await file.text());
      toast(t('settings.restored'));
    } catch (err) {
      toast(errorText(err));
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
      toast(t('settings.imported', { n: result.imported, skip: result.skipped }));
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onWallpaper(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      patchRegion(region, { image: dataUrl });
    } catch {
      toast(t('settings.importFailed'));
    }
  }

  function wipe() {
    if (!window.confirm(t('settings.wipeConfirm1'))) return;
    if (!window.confirm(t('settings.wipeConfirm2'))) return;
    indexedDB.deleteDatabase('yichen-ledger');
    window.location.reload();
  }

  const current = appearance.regions[region];

  const regionLabel: Record<RegionKey, string> = {
    sidebar: t('settings.regionSidebar'),
    main: t('settings.regionMain'),
    tabbar: t('settings.regionTabbar'),
  };

  const fitOptions: Array<[FitMode, string]> = [
    ['cover', t('settings.fitCover')],
    ['contain', t('settings.fitContain')],
    ['fill', t('settings.fitFill')],
    ['center', t('settings.fitCenter')],
  ];

  const fontOptions: Array<[FontStyle, string]> = [
    ['system', t('settings.fontSystem')],
    ['serif', t('settings.fontSerif')],
    ['kai', t('settings.fontKai')],
    ['rounded', t('settings.fontRounded')],
  ];

  const langOptions: Array<[LangSetting, string]> = [
    ['system', t('settings.languageSystem')],
    ['zh', t('settings.languageZh')],
    ['en', t('settings.languageEn')],
    ['ja', t('settings.languageJa')],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <div className="page-sub">{t('settings.sub')}</div>
        </div>
      </div>

      {/* ---------- 通用 ---------- */}
      <div className="section-title">{t('settings.groupGeneral')}</div>
      <section className="card" style={{ padding: '4px 16px' }}>
        <Row name={t('settings.language')} hint={t('settings.languageHint')}>
          <select
            className="set-select"
            value={setting}
            onChange={(e) => setLang(e.target.value as LangSetting)}
          >
            {langOptions.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Row>
        <Row name={t('settings.startup')} hint={t('settings.startupHint')}>
          <select
            className="set-select"
            value={startup}
            onChange={(e) => changeStartup(e.target.value as Startup)}
          >
            <option value="dashboard">{t('settings.startupDashboard')}</option>
            <option value="stats">{t('settings.startupStats')}</option>
            <option value="budgets">{t('settings.startupBudgets')}</option>
          </select>
        </Row>
        <Row name={t('common.manage')}>
          <Link to="/accounts" className="chip-link">
            {t('nav.accounts')}
            <ChevronRight size={13} />
          </Link>
          <Link to="/categories" className="chip-link">
            {t('nav.categories')}
            <ChevronRight size={13} />
          </Link>
        </Row>
      </section>

      {/* ---------- 外观 ---------- */}
      <div className="section-title">{t('settings.groupAppearance')}</div>

      <section className="card" style={{ padding: '4px 16px' }}>
        <Row name={t('settings.fontStyle')} hint={t('settings.fontStyleHint')}>
          <select
            className="set-select"
            value={appearance.fontStyle}
            onChange={(e) => patch({ fontStyle: e.target.value as FontStyle })}
          >
            {fontOptions.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Row>
        <Slider
          label={t('settings.fontScale')}
          value={appearance.fontScale}
          min={100}
          max={140}
          step={5}
          unit="%"
          onChange={(n) => patch({ fontScale: n })}
        />
        <Row name={t('settings.textColor')}>
          <input
            type="color"
            className="color-dot"
            value={appearance.textColor ?? '#e8edf4'}
            onChange={(e) => patch({ textColor: e.target.value })}
          />
          <button className="btn tiny" onClick={() => patch({ textColor: null })}>
            {t('settings.textColorAuto')}
          </button>
        </Row>
        <Row name={t('settings.accentColor')}>
          <input
            type="color"
            className="color-dot"
            value={appearance.accentColor ?? '#ffb454'}
            onChange={(e) => patch({ accentColor: e.target.value })}
          />
          <button className="btn tiny" onClick={() => patch({ accentColor: null })}>
            {t('settings.accentAuto')}
          </button>
        </Row>
        <Slider
          label={t('settings.radius')}
          value={appearance.radius}
          min={0}
          max={26}
          unit="px"
          onChange={(n) => patch({ radius: n })}
        />
      </section>

      {/* ---------- 水晶玻璃 ---------- */}
      <div className="section-title">{t('settings.groupGlass')}</div>

      <section className="card" style={{ padding: '4px 16px' }}>
        <Row name={t('settings.theme')} hint={t('settings.themeHint')}>
          <div className="segmented theme-seg">
            {THEMES.map(([value, label]) => (
              <button
                key={value}
                className={appearance.theme === value ? 'on' : ''}
                onClick={() => patch({ theme: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Slider
          label={t('settings.glass')}
          value={appearance.glass}
          min={0}
          max={150}
          step={5}
          unit="%"
          onChange={(n) => patch({ glass: n })}
        />
        <div className="set-hint" style={{ paddingBottom: 12 }}>
          {t('settings.glassHint')}
        </div>
      </section>

      {/* 三个区域各自一张壁纸 */}
      <section className="card">
        <div className="row" style={{ marginBottom: 4 }}>
          <div className="grow">
            <div className="set-name">{t('settings.wallpaper')}</div>
            <div className="set-hint">{t('settings.regionHint')}</div>
          </div>
        </div>

        <div className="region-tabs">
          {REGIONS.map((r) => (
            <button
              key={r}
              className={region === r ? 'on' : ''}
              onClick={() => setRegion(r)}
              type="button"
            >
              {regionLabel[r]}
              {appearance.regions[r].image ? <span className="dot-on" /> : null}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <button className="btn" onClick={() => wallpaperInput.current?.click()}>
            <ImageIcon size={15} />
            {t('settings.wallpaperUpload')}
          </button>
          <button
            className="btn"
            disabled={!current.image}
            onClick={() => patchRegion(region, { image: null })}
          >
            {t('settings.wallpaperClear')}
          </button>
          <div className="grow" />
          <button className="btn tiny" onClick={() => copyToAll(region)}>
            <Copy size={13} />
            {t('settings.copyToAll')}
          </button>
        </div>
        <div className="set-hint" style={{ marginBottom: 10 }}>
          {t('settings.wallpaperHint')}
        </div>

        {current.image ? (
          <>
            <Slider
              label={t('settings.blur')}
              value={current.blur}
              min={0}
              max={30}
              unit="px"
              onChange={(n) => patchRegion(region, { blur: n })}
            />
            <Slider
              label={t('settings.brightness')}
              value={current.brightness}
              min={20}
              max={160}
              unit="%"
              onChange={(n) => patchRegion(region, { brightness: n })}
            />
            <Slider
              label={t('settings.contrast')}
              value={current.contrast}
              min={40}
              max={180}
              unit="%"
              onChange={(n) => patchRegion(region, { contrast: n })}
            />
            <Slider
              label={t('settings.saturation')}
              value={current.saturation}
              min={0}
              max={200}
              unit="%"
              onChange={(n) => patchRegion(region, { saturation: n })}
            />
            <Slider
              label={t('settings.offsetX')}
              value={current.offsetX}
              min={0}
              max={100}
              unit="%"
              onChange={(n) => patchRegion(region, { offsetX: n })}
            />
            <Slider
              label={t('settings.offsetY')}
              value={current.offsetY}
              min={0}
              max={100}
              unit="%"
              onChange={(n) => patchRegion(region, { offsetY: n })}
            />
            <Slider
              label={t('settings.scale')}
              value={current.scale}
              min={100}
              max={200}
              unit="%"
              onChange={(n) => patchRegion(region, { scale: n })}
            />
            <Slider
              label={t('settings.opacity')}
              value={current.opacity}
              min={10}
              max={100}
              unit="%"
              onChange={(n) => patchRegion(region, { opacity: n })}
            />
            <Slider
              label={t('settings.dim')}
              value={current.dim}
              min={0}
              max={90}
              unit="%"
              onChange={(n) => patchRegion(region, { dim: n })}
            />
            <Row name={t('settings.fit')}>
              <select
                className="set-select"
                value={current.fit}
                onChange={(e) => patchRegion(region, { fit: e.target.value as FitMode })}
              >
                {fitOptions.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Row>
            <Row name={t('settings.flipX')}>
              <input
                type="checkbox"
                className="switch"
                checked={current.flipX}
                onChange={(e) => patchRegion(region, { flipX: e.target.checked })}
              />
            </Row>
          </>
        ) : null}

        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <button className="btn tiny" onClick={() => resetRegion(region)}>
            <RotateCcw size={13} />
            {t('settings.resetRegion')}
          </button>
          <div className="grow" />
          <button className="btn tiny" onClick={resetAll}>
            <RotateCcw size={13} />
            {t('settings.resetAppearance')}
          </button>
        </div>

        <input
          ref={wallpaperInput}
          type="file"
          accept="image/*"
          hidden
          onChange={onWallpaper}
        />
      </section>

      {/* ---------- 数据 ---------- */}
      <div className="section-title">{t('settings.groupData')}</div>

      <section className="card banner-warn">
        <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <AlertTriangle size={18} style={{ marginTop: 2, flex: '0 0 auto' }} />
          <div className="grow">
            <div className="banner-title">{t('settings.localBannerTitle')}</div>
            <div className="banner-body">{t('settings.localBannerBody')}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ gap: 16 }}>
          <div className="grow">
            <div className="muted">{t('settings.records')}</div>
            <div className="stat-num">{transactions.length}</div>
          </div>
          <div className="grow">
            <div className="muted">{t('settings.accounts')}</div>
            <div className="stat-num">{accounts.length}</div>
          </div>
          <div className="grow">
            <div className="muted">{t('settings.categories')}</div>
            <div className="stat-num">{categories.length}</div>
          </div>
          <div className="grow">
            <div className="muted">{t('settings.budgets')}</div>
            <div className="stat-num">{budgets.length}</div>
          </div>
        </div>
      </section>

      <div className="section-title">{t('settings.backup')}</div>
      <section className="card">
        <div className="privacy-line">{t('settings.privacyLine')}</div>
        <div className="muted" style={{ marginBottom: 12 }}>
          {t('settings.backupHint')}
        </div>
        <button className="btn block" style={{ marginBottom: 8 }} onClick={doExportBackup} disabled={busy}>
          <Download size={15} />
          {t('settings.exportJson')}
        </button>
        <button className="btn block" style={{ marginBottom: 8 }} onClick={doExportCsv} disabled={busy}>
          <Download size={15} />
          {t('settings.exportCsv')}
        </button>
        <button
          className="btn block"
          style={{ marginBottom: 8 }}
          onClick={() => backupInput.current?.click()}
          disabled={busy}
        >
          <Upload size={15} />
          {t('settings.importJson')}
        </button>
        <button className="btn block" onClick={() => csvInput.current?.click()} disabled={busy}>
          <Upload size={15} />
          {t('settings.importCsv')}
        </button>
        <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={onBackupFile} />
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
      </section>

      {/* ---------- AI ---------- */}
      <div className="section-title">{t('settings.aiTitle')}</div>
      <section className="card">
        <div className="muted" style={{ marginBottom: 12, lineHeight: 1.62 }}>
          {t('settings.aiHint')}
        </div>

        <Row name={t('settings.aiProvider')}>
          <select
            className="input"
            value={ai.provider}
            onChange={(e) => {
              const provider = e.target.value as AiProvider;
              const preset = PROVIDER_PRESETS[provider];
              setAi({
                ...ai,
                provider,
                baseUrl: preset.baseUrl || ai.baseUrl,
                model: preset.model || ai.model,
              });
            }}
          >
            <option value="deepseek">{t('settings.aiProviderDeepseek')}</option>
            <option value="openai">{t('settings.aiProviderOpenai')}</option>
            <option value="custom">{t('settings.aiProviderCustom')}</option>
          </select>
        </Row>

        <Row name={t('settings.aiBaseUrl')}>
          <input
            className="input"
            value={ai.baseUrl}
            placeholder="https://api.deepseek.com"
            onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
          />
        </Row>

        <Row name={t('settings.aiModel')} hint={t('settings.aiModelHint')}>
          <input
            className="input"
            value={ai.model}
            placeholder="deepseek-chat"
            onChange={(e) => setAi({ ...ai, model: e.target.value })}
          />
        </Row>

        <Row name={t('settings.aiApiKey')} hint={t('settings.aiApiKeyHint')}>
          <input
            className="input"
            type="password"
            value={ai.apiKey}
            placeholder="sk-…"
            autoComplete="off"
            onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
          />
        </Row>

        <div className="row gap" style={{ marginTop: 12 }}>
          <button
            className="btn primary grow"
            onClick={() => {
              void saveAi(ai).then(() => toast(t('settings.aiSaved')));
            }}
          >
            {t('settings.aiSave')}
          </button>
          <button
            className="btn"
            onClick={() => {
              void saveAi({ ...ai, apiKey: '' }).then(() => toast(t('settings.aiCleared')));
            }}
          >
            {t('settings.aiClear')}
          </button>
        </div>
      </section>

      <div className="section-title">{t('settings.danger')}</div>
      <section className="card">
        <button className="btn danger block" onClick={wipe}>
          {t('settings.wipe')}
        </button>
      </section>

      {/* ---------- 关于 ---------- */}
      <div className="section-title">{t('settings.groupAbout')}</div>
      <section className="card">
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="brand-mark">忆</div>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {t('app.name')} v{__APP_VERSION__}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {t('settings.aboutText')}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <a
            className="btn tiny"
            href="https://yichen520-1.github.io/yichen-ledger/"
            target="_blank"
            rel="noreferrer"
          >
            {t('settings.viewOnline')}
          </a>
          <a
            className="btn tiny"
            href="https://github.com/yichen520-1/yichen-ledger"
            target="_blank"
            rel="noreferrer"
          >
            {t('settings.viewSource')}
          </a>
          <div className="grow" />
          <span className="muted mono">
            {lang.toUpperCase()} · v{__APP_VERSION__}
          </span>
        </div>
      </section>
    </>
  );
}
