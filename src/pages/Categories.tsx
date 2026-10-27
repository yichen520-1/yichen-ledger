import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n, useErrorText } from '../i18n';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { deleteCategory, saveCategory } from '../db/repository';
import { newId, type Category } from '../domain/model';

const COLORS = ['#ef6f4d', '#e0a83a', '#69a84f', '#3aa7a0', '#4a90d9', '#8a7cd6', '#c96fb7', '#d95f6c', '#8d8d8d'];
const ICONS = ['🍜', '🥬', '🚌', '🛍️', '🏠', '💡', '📱', '🎮', '💊', '📚', '🎁', '🐾', '✈️', '💰', '🧧', '🏷️', '☕', '🎧'];

export default function Categories() {
  const { categories } = useLedger();
  const toast = useToast();
  const { t } = useI18n();
  const errorText = useErrorText();
  const [tab, setTab] = useState<'expense' | 'income'>('expense');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [color, setColor] = useState(COLORS[0]);

  const list = useMemo(() => categories.filter((c) => c.type === tab), [categories, tab]);

  function openNew() {
    setName('');
    setIcon('🏷️');
    setColor(COLORS[0]);
    setOpen(true);
  }

  async function save() {
    if (!name.trim()) return toast(t('categories.nameRequired'));
    const category: Category = {
      id: newId('cat-'),
      name: name.trim(),
      type: tab,
      icon,
      color,
      builtin: false,
      sort: list.length,
    };
    await saveCategory(category);
    setOpen(false);
    toast(t('categories.added'));
  }

  async function remove(c: Category) {
    if (!window.confirm(t('categories.confirmDelete', { name: c.name }))) return;
    try {
      await deleteCategory(c.id);
      toast(t('common.delete'));
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('categories.title')}</h1>
          <div className="page-sub">{t('categories.sub')}</div>
        </div>
        <button className="btn primary" onClick={openNew}>
          <Plus size={15} />
          {t('common.add')}
        </button>
      </div>

      <div className="segmented" style={{ maxWidth: 260 }}>
        <button data-type="expense" className={tab === 'expense' ? 'on' : ''} onClick={() => setTab('expense')}>
          {t('common.expense')}
        </button>
        <button data-type="income" className={tab === 'income' ? 'on' : ''} onClick={() => setTab('income')}>
          {t('common.income')}
        </button>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        {list.map((c) => (
          <div key={c.id} className="tx-row">
            <div className="tx-icon" style={{ background: `${c.color}22` }}>
              {c.icon}
            </div>
            <div className="tx-body">
              <div className="tx-title">{c.name}</div>
              <div className="tx-meta">{c.builtin ? t('categories.builtin') : t('categories.custom')}</div>
            </div>
            {!c.builtin ? (
              <button onClick={() => remove(c)} className="muted" style={{ padding: '4px 6px' }}>
                {t('categories.noDelete')}
              </button>
            ) : null}
          </div>
        ))}
      </section>

      <Sheet open={open} onClose={() => setOpen(false)} title={tab === 'expense' ? t('categories.sheetExpense') : t('categories.sheetIncome')}>
        <div className="field">
          <label>{t('categories.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={10}
            placeholder={t('categories.namePlaceholder')}
            autoFocus
          />
        </div>
        <div className="section-title" style={{ marginTop: 12 }}>
          {t('categories.icon')}
        </div>
        <div className="cat-grid" style={{ gridTemplateColumns: 'repeat(9, 1fr)', gap: 6 }}>
          {ICONS.map((i) => (
            <button
              key={i}
              className={`cat-chip${icon === i ? ' on' : ''}`}
              style={{ padding: '8px 0' }}
              onClick={() => setIcon(i)}
            >
              <span className="ico">{i}</span>
            </button>
          ))}
        </div>
        <div className="section-title" style={{ marginTop: 4 }}>
          {t('categories.color')}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={c}
              style={{
                width: 28,
                height: 28,
                borderRadius: 9,
                background: c,
                border: color === c ? '2px solid var(--text)' : '2px solid transparent',
              }}
            />
          ))}
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn grow" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary grow" onClick={save}>
            {t('common.save')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
