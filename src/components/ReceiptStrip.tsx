import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { useErrorText, useI18n } from '../i18n';
import { addReceipt, deleteReceipt } from '../db/repository';
import { RECEIPT_MAX_PER_TX, formatBytes } from '../domain/receipt';

/**
 * 收据条：一笔账目下面挂着的那几张照片。
 *
 * 为什么缩略图用 object-fit: cover 而不是 contain：
 *   一排小方块里，cover 让每张都填满、视觉上整齐；点开看大图时再 contain。
 * 为什么删除要二次确认：
 *   照片删了找不回来（没有云端），这是这个 App 里唯一「删了就永远没了」的东西。
 */
export function ReceiptStrip({ txId, editable }: { txId: string; editable?: boolean }) {
  const { receiptsByTx } = useLedger();
  const { t } = useI18n();
  const toast = useToast();
  const errorText = useErrorText();
  const [viewing, setViewing] = useState<{ url: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const list = receiptsByTx.get(txId) ?? [];
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of list) map.set(r.id, URL.createObjectURL(r.blob));
    return map;
  }, [list]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await addReceipt(txId, file);
      }
      toast(t('receipt.saved'));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('receipt.confirmDelete'))) return;
    try {
      await deleteReceipt(id);
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (!editable && list.length === 0) return null;

  return (
    <>
      <div className="receipt-strip">
        {list.map((r) => (
          <button
            key={r.id}
            className="receipt-thumb"
            onClick={() => setViewing({ url: urls.get(r.id) ?? '', id: r.id })}
            title={`${r.name} · ${formatBytes(r.size)}`}
          >
            <img src={urls.get(r.id)} alt={r.name} />
          </button>
        ))}
        {editable && list.length < RECEIPT_MAX_PER_TX ? (
          <label className="receipt-add">
            {busy ? (
              t('receipt.saving')
            ) : (
              <>
                <Plus size={16} />
                <span>{t('receipt.add')}</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void onFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </label>
        ) : null}
      </div>

      {viewing ? (
        <div className="receipt-viewer" onClick={() => setViewing(null)}>
          <img src={viewing.url} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="receipt-viewer-bar">
            <button className="btn" onClick={() => setViewing(null)}>
              {t('receipt.close')}
            </button>
            {editable ? (
              <button
                className="btn danger"
                onClick={() => {
                  void remove(viewing.id);
                  setViewing(null);
                }}
              >
                {t('receipt.delete')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
