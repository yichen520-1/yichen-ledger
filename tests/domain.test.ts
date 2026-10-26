import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  budgetStatus,
  csvEscape,
  currentMonthKey,
  dailyExpense,
  dateRange,
  daysInMonth,
  expenseByCategory,
  formatCents,
  formatCentsCompact,
  monthTotals,
  monthlyTrend,
  netWorth,
  parseAmountToCents,
  parseCsv,
  parseTags,
  shiftMonth,
  toCsv,
  toDateKey,
  txsToCsvRows,
  type Account,
  type Budget,
  type Category,
  type Transaction,
} from '../src/domain/model';

function acc(id: string, initial = 0, extra: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    kind: 'cash',
    initialBalance: initial,
    currency: 'CNY',
    includeInTotal: true,
    archived: false,
    sort: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...extra,
  };
}

function tx(partial: Partial<Transaction> & { amount: number; date?: string }): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'expense',
    categoryId: null,
    accountId: 'a1',
    toAccountId: null,
    date: '2024-01-01',
    note: '',
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  } as Transaction;
}

describe('金额格式化', () => {
  it('把分格式化成带千分位的金额', () => {
    expect(formatCents(0)).toBe('¥0.00');
    expect(formatCents(5)).toBe('¥0.05');
    expect(formatCents(123456789)).toBe('¥1,234,567.89');
    expect(formatCents(-1234)).toBe('-¥12.34');
  });

  it('紧凑格式用于图表坐标轴', () => {
    expect(formatCentsCompact(0)).toBe('0');
    expect(formatCentsCompact(123456)).toBe('1235');
    expect(formatCentsCompact(1500000)).toBe('1.50万');
    expect(formatCentsCompact(-15000000000)).toBe('-1.50亿');
  });
});

describe('金额解析', () => {
  it('接受常见输入', () => {
    expect(parseAmountToCents('12')).toBe(1200);
    expect(parseAmountToCents('12.3')).toBe(1230);
    expect(parseAmountToCents('12.34')).toBe(1234);
    expect(parseAmountToCents('1,234.56')).toBe(123456);
    expect(parseAmountToCents('¥ 12.30')).toBe(1230);
    expect(parseAmountToCents(' 8 ')).toBe(800);
  });

  it('规避浮点误差', () => {
    // 0.1 * 100 === 10.000000000000002
    expect(parseAmountToCents('0.1')).toBe(10);
    expect(parseAmountToCents('1.15')).toBe(115);
    expect(parseAmountToCents('8.29')).toBe(829);
  });

  it('拒绝非法输入', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('1.234')).toBeNull();
    expect(parseAmountToCents('.')).toBeNull();
    expect(parseAmountToCents('-')).toBeNull();
    expect(parseAmountToCents('１２')).toBeNull();
  });
});

describe('日期工具', () => {
  it('toDateKey 用本地日历日', () => {
    expect(toDateKey(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(toDateKey(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  it('跨年加减月份', () => {
    expect(shiftMonth('2024-01', -1)).toBe('2023-12');
    expect(shiftMonth('2024-12', 1)).toBe('2025-01');
    expect(shiftMonth('2024-03', -14)).toBe('2023-01');
  });

  it('每月天数含闰年', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2023-02')).toBe(28);
    expect(daysInMonth('2024-04')).toBe(30);
  });

  it('dateRange 含首尾', () => {
    expect(dateRange('2024-01-30', '2024-02-02')).toEqual([
      '2024-01-30',
      '2024-01-31',
      '2024-02-01',
      '2024-02-02',
    ]);
  });

  it('currentMonthKey 补零', () => {
    expect(currentMonthKey(new Date(2024, 8, 9))).toBe('2024-09');
  });
});

describe('账户余额与净资产', () => {
  const accounts = [acc('a1', 10000), acc('a2', 5000)];
  const txs = [
    tx({ amount: 2000, accountId: 'a1' }), // 支出 20 -> a1 = 80
    tx({ amount: 500, accountId: 'a1', type: 'income' }), // 收入 5 -> a1 = 85
    tx({ amount: 1000, accountId: 'a1', toAccountId: 'a2', type: 'transfer' }), // a1 = 75, a2 = 60
  ];

  it('支出减、收入加、转账双边', () => {
    expect(accountBalance(accounts[0], txs)).toBe(7500);
    expect(accountBalance(accounts[1], txs)).toBe(6000);
  });

  it('净资产跳过归档与不计入账户', () => {
    expect(netWorth(accounts, txs)).toBe(13500);
    expect(netWorth([...accounts, acc('a3', 99999, { includeInTotal: false })], txs)).toBe(13500);
    expect(netWorth([...accounts, acc('a4', 99999, { archived: true })], txs)).toBe(13500);
  });
});

describe('汇总', () => {
  const txs = [
    tx({ amount: 3000, date: '2024-03-01', categoryId: 'c1' }),
    tx({ amount: 2000, date: '2024-03-05', categoryId: 'c1' }),
    tx({ amount: 1000, date: '2024-03-20', categoryId: 'c2' }),
    tx({ amount: 8000, date: '2024-03-10', type: 'income', categoryId: 'i1' }),
    tx({ amount: 500, date: '2024-02-10', categoryId: 'c1' }),
    tx({ amount: 7777, date: '2024-03-15', type: 'transfer' }),
  ];

  it('月收支不含转账', () => {
    expect(monthTotals(txs, '2024-03')).toEqual({ income: 8000, expense: 6000 });
    expect(monthTotals(txs, '2024-02')).toEqual({ income: 0, expense: 500 });
    expect(monthTotals(txs, '2024-04')).toEqual({ income: 0, expense: 0 });
  });

  it('分类汇总降序', () => {
    expect(expenseByCategory(txs, '2024-03')).toEqual([
      { categoryId: 'c1', amount: 5000 },
      { categoryId: 'c2', amount: 1000 },
    ]);
  });

  it('趋势序列按时间正序', () => {
    const trend = monthlyTrend(txs, '2024-03', 3);
    expect(trend.map((t) => t.month)).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(trend[2]).toEqual({ month: '2024-03', income: 8000, expense: 6000 });
  });

  it('单日支出', () => {
    expect(dailyExpense(txs, '2024-03-01')).toBe(3000);
    expect(dailyExpense(txs, '2024-03-15')).toBe(0); // 转账不算支出
  });
});

describe('预算', () => {
  const txs = [
    tx({ amount: 3000, date: '2024-03-01', categoryId: 'c1' }),
    tx({ amount: 2000, date: '2024-03-05', categoryId: 'c2' }),
  ];
  const budgets: Budget[] = [
    { id: 'b1', categoryId: 'c1', amount: 4000, month: null, createdAt: '' },
    { id: 'b2', categoryId: null, amount: 10000, month: null, createdAt: '' },
    { id: 'b3', categoryId: 'c2', amount: 1000, month: null, createdAt: '' },
  ];

  it('超支标记与占比', () => {
    // budgetStatus 按使用率从高到低排序（最紧张的排最前），所以按 id 取而不是按下标
    const byId = new Map(budgetStatus(budgets, txs, '2024-03').map((s) => [s.budget.id, s]));

    const total = byId.get('b2')!;
    expect(total.spent).toBe(5000); // 总预算 = 所有分类支出之和
    expect(total.ratio).toBeCloseTo(0.5);
    expect(total.over).toBe(false);

    const food = byId.get('b1')!;
    expect(food.spent).toBe(3000);
    expect(food.over).toBe(false);

    const overspent = byId.get('b3')!;
    expect(overspent.spent).toBe(2000);
    expect(overspent.ratio).toBeCloseTo(2);
    expect(overspent.over).toBe(true);
  });

  it('按使用率从高到低排序', () => {
    const order = budgetStatus(budgets, txs, '2024-03').map((s) => s.budget.id);
    expect(order).toEqual(['b3', 'b1', 'b2']); // 2.0 → 0.75 → 0.5
  });

  it('只在生效月份出现', () => {
    const only = [{ id: 'b9', categoryId: 'c1', amount: 1, month: '2024-04', createdAt: '' }];
    expect(budgetStatus(only, txs, '2024-03')).toHaveLength(0);
    expect(budgetStatus(only, txs, '2024-04')).toHaveLength(1);
  });
});

describe('CSV', () => {
  const categories: Category[] = [
    { id: 'c1', name: '餐饮', type: 'expense', icon: '🍜', color: '#000', builtin: true, sort: 0 },
    { id: 'i1', name: '工资', type: 'income', icon: '💰', color: '#000', builtin: true, sort: 0 },
  ];
  const accounts = [acc('a1'), acc('a2')];
  const txs = [
    tx({ amount: 1234, date: '2024-03-01', categoryId: 'c1', note: '带,逗号' }),
    tx({ amount: 500000, date: '2024-03-02', type: 'income', categoryId: 'i1' }),
    tx({ amount: 100, date: '2024-03-03', type: 'transfer', accountId: 'a1', toAccountId: 'a2' }),
  ];

  it('转义引号与逗号', () => {
    expect(csvEscape('简单')).toBe('简单');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('说"好"')).toBe('"说""好"""');
    expect(csvEscape('换\n行')).toBe('"换\n行"');
  });

  it('导出带 BOM 与 CRLF', () => {
    const csv = toCsv(txsToCsvRows(txs, categories, accounts));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('日期,类型,金额,分类,账户,转入账户,备注,标签');
    expect(csv).toContain('\r\n');
    expect(csv).toContain('12.34');
    expect(csv).toContain('支出');
    expect(csv).toContain('转账');
  });

  it('解析支持引号内逗号与换行', () => {
    const rows = parseCsv('a,b\n"x,y","line1\nline2"\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2'],
    ]);
  });

  it('导出再导入行数一致', () => {
    const csv = toCsv(txsToCsvRows(txs, categories, accounts));
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4); // 表头 + 3 行
  });
});

describe('标签', () => {
  it('去重并支持多种分隔符', () => {
    expect(parseTags('吃饭 朋友,聚餐、吃饭')).toEqual(['吃饭', '朋友', '聚餐']);
    expect(parseTags('   ')).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });
});
