import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { deleteCategory, saveCategory } from '../db/repository';
import { newId, type Category } from '../domain/model';

const COLORS = ['#ef6f4d', '#e0a83a', '#69a84f', '#3aa7a0', '#4a90d9', '#8a7cd6', '#c96fb7', '#d95f6c', '#8d8d8d'];
const ICONS = ['🍜', '🥬', '🚌', '🛍️', '🏠', '💡', '📱', '🎮', '💊', '📚', '🎁', '🐾', '✈️', '💰', '🧧', '🏷️', '☕', '🎧'];

export default function Categories() {
  const { categories } = useLedger();
  const toast = useToast();
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
    if (!name.trim()) return toast('请填写分类名称');
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
    toast('分类已添加');
  }

  async function remove(c: Category) {
    if (!window.confirm(`删除分类「${c.name}」？`)) return;
    try {
      await deleteCategory(c.id);
      toast('已删除');
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">分类</h1>
          <div className="page-sub">内置分类不可删除，可自己添加</div>
        </div>
        <button className="btn primary" onClick={openNew}>
          <Plus size={15} />
          添加
        </button>
      </div>

      <div className="segmented" style={{ maxWidth: 260 }}>
        <button data-type="expense" className={tab === 'expense' ? 'on' : ''} onClick={() => setTab('expense')}>
          支出
        </button>
        <button data-type="income" className={tab === 'income' ? 'on' : ''} onClick={() => setTab('income')}>
          收入
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
              <div className="tx-meta">{c.builtin ? '内置分类' : '自定义分类'}</div>
            </div>
            {!c.builtin ? (
              <button onClick={() => remove(c)} className="muted" style={{ padding: '4px 6px' }}>
                删除
              </button>
            ) : null}
          </div>
        ))}
      </section>

      {open ? (
        <div className="sheet-mask" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>添加{tab === 'expense' ? '支出' : '收入'}分类</h3>
            <div className="field">
              <label>名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={10} placeholder="比如 咖啡" autoFocus />
            </div>
            <div className="section-title" style={{ marginTop: 12 }}>
              图标
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
              颜色
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
                取消
              </button>
              <button className="btn primary grow" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
