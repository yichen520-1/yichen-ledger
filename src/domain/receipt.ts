/**
 * 收据附件（v0.9.0）
 * ------------------------------------------------------------------
 * 大额支出光记一个数字，半年后完全不记得买了什么。
 * 拍一张存下来就解决了 —— 而且不用上传任何地方，图片就在你自己的设备里。
 *
 * 存 Blob 不存 base64：
 *   base64 会让体积涨 33%，读出来还要解码一次。IndexedDB 原生支持 Blob。
 *
 * 压不压缩：
 *   压缩是有损的，发票上的小字可能就糊了。所以不压 ——
 *   但限制单张 8MB，并在超过时明确提示，而不是偷偷压。
 */

export interface Receipt {
  id: string;
  /** 属于哪笔账目 */
  txId: string;
  /** 图片本体 */
  blob: Blob;
  /** MIME 类型，回显时用 */
  mime: string;
  /** 原始文件名（桌面端选文件时有），手机拍照时是空串 */
  name: string;
  /** 字节数，列表里显示大小 */
  size: number;
  createdAt: string;
}

/** 单张上限 8MB。再大就不是「收据」而是「扫描件」了，那该走备份。 */
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

/** 只收图片 */
export function isImageFile(file: { type: string }): boolean {
  return /^image\//.test(file.type);
}

/** 人类可读的文件大小 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 校验一个文件能不能收，返回错误码或 null */
export type ReceiptReject = 'receipt.notImage' | 'receipt.tooLarge';

export function checkReceiptFile(file: { type: string; size: number }): ReceiptReject | null {
  if (!isImageFile(file)) return 'receipt.notImage';
  if (file.size > RECEIPT_MAX_BYTES) return 'receipt.tooLarge';
  return null;
}

/** 一笔账目最多挂几张。太多会拖慢列表渲染，也没人真会看第 20 张。 */
export const RECEIPT_MAX_PER_TX = 9;

/** 按账目分组，列表页一次算好 */
export function groupByTx(receipts: Receipt[]): Map<string, Receipt[]> {
  const map = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const list = map.get(r.txId) ?? [];
    list.push(r);
    map.set(r.txId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return map;
}

/** 生成缩略图（用 canvas 缩放，避免列表里直接渲染 8MB 原图） */
export async function makeThumbnail(blob: Blob, maxSide = 240): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  }
}
