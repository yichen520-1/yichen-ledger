import { describe, expect, it } from 'vitest';
import { detectSmallTalk, evalArithmetic, isFollowUp } from '../src/domain/chat';

/* ------------------------------------------------------------ 算术 */

describe('算术题', () => {
  it('认得出加减乘除', () => {
    expect(evalArithmetic('12+30')?.value).toBe('42');
    expect(evalArithmetic('100 - 45')?.value).toBe('55');
    expect(evalArithmetic('6*7')?.value).toBe('42');
    expect(evalArithmetic('10/4')?.value).toBe('2.5');
  });

  it('认全角符号和中文问法', () => {
    expect(evalArithmetic('１２＋３０')?.value).toBe('42');
    expect(evalArithmetic('12+30等于多少')?.value).toBe('42');
    expect(evalArithmetic('8 × 9 是多少')?.value).toBe('72');
  });

  it('浮点误差不会露出来', () => {
    expect(evalArithmetic('0.1+0.2')?.value).toBe('0.3');
  });

  it('除以零返回 null，不返回 Infinity', () => {
    expect(evalArithmetic('5/0')).toBeNull();
  });

  it('带文字的句子不当成算术', () => {
    expect(evalArithmetic('记一笔 25+30')).toBeNull();
    expect(evalArithmetic('这个月花了 12+30 元')).toBeNull();
  });
});

/* --------------------------------------------------------- 追问识别 */

describe('追问', () => {
  it('短句的「那…呢」算追问', () => {
    expect(isFollowUp('那上个月呢')).toBe(true);
    expect(isFollowUp('还有呢')).toBe(true);
    expect(isFollowUp('换成去年')).toBe(true);
    expect(isFollowUp('继续')).toBe(true);
  });

  it('完整的问题不算追问', () => {
    expect(isFollowUp('这个月花了多少')).toBe(false);
    expect(isFollowUp('帮我记一笔午饭 25')).toBe(false);
  });
});

/* --------------------------------------------------------- 闲聊意图 */

describe('闲聊意图', () => {
  const noon = new Date('2024-03-15T12:34:00');

  it('打招呼', () => {
    for (const s of ['你好', '您好', 'hello', 'hi', '在吗', '哈喽']) {
      expect(detectSmallTalk(s, noon)?.kind).toBe('greeting');
    }
  });

  it('打招呼会带上时段，半夜不会说早上好', () => {
    const at = (h: number) => new Date(`2024-03-15T${String(h).padStart(2, '0')}:00:00`);
    expect(detectSmallTalk('你好', at(7))?.detail).toBe('morning');
    expect(detectSmallTalk('你好', at(12))?.detail).toBe('noon');
    expect(detectSmallTalk('你好', at(15))?.detail).toBe('afternoon');
    expect(detectSmallTalk('你好', at(20))?.detail).toBe('evening');
    expect(detectSmallTalk('你好', at(2))?.detail).toBe('night');
  });

  it('用户明说了「早上好」就按他说的回', () => {
    expect(detectSmallTalk('早上好', new Date('2024-03-15T23:00:00'))?.detail).toBe('morning');
    expect(detectSmallTalk('晚上好', new Date('2024-03-15T09:00:00'))?.detail).toBe('evening');
  });

  it('问你是谁', () => {
    for (const s of ['你是谁', '你叫什么名字', '介绍一下你自己', 'who are you']) {
      expect(detectSmallTalk(s, noon)?.kind).toBe('identity');
    }
  });

  it('问能做什么', () => {
    for (const s of ['你能做什么', '你会什么', '有什么功能', 'what can you do']) {
      expect(detectSmallTalk(s, noon)?.kind).toBe('capability');
    }
  });

  it('道谢、道别、道歉', () => {
    expect(detectSmallTalk('谢谢', noon)?.kind).toBe('thanks');
    expect(detectSmallTalk('thanks a lot', noon)?.kind).toBe('thanks');
    expect(detectSmallTalk('再见', noon)?.kind).toBe('farewell');
    expect(detectSmallTalk('抱歉', noon)?.kind).toBe('apology');
  });

  it('夸人不会被当成打招呼', () => {
    expect(detectSmallTalk('你好厉害', noon)?.kind).toBe('praise');
    expect(detectSmallTalk('你真棒', noon)?.kind).toBe('praise');
  });

  it('说心情能分出是累还是难过', () => {
    const noon = new Date('2024-03-15T12:34:00');
    expect(detectSmallTalk('今天好累', noon)?.detail).toBe('tired');
    expect(detectSmallTalk('我很难过', noon)?.detail).toBe('sad');
    expect(detectSmallTalk('烦死了', noon)?.detail).toBe('angry');
    expect(detectSmallTalk('压力好大', noon)?.detail).toBe('anxious');
    expect(detectSmallTalk('今天很开心', noon)?.detail).toBe('happy');
    expect(detectSmallTalk('好无聊', noon)?.detail).toBe('bored');
    expect(detectSmallTalk('有点孤单', noon)?.detail).toBe('lonely');
  });

  it('问时间会带上几点', () => {
    const r = detectSmallTalk('现在几点了', noon);
    expect(r?.kind).toBe('clock');
    expect(r?.detail).toBe('12:34');
  });

  it('问日期会带上星期', () => {
    const r = detectSmallTalk('今天几号', noon);
    expect(r?.kind).toBe('date');
    expect(r?.detail).toBe('2024-03-15');
    expect(r?.weekday).toBe(5); // 2024-03-15 是周五
  });

  it('天气和笑话', () => {
    expect(detectSmallTalk('今天天气怎么样', noon)?.kind).toBe('weather');
    expect(detectSmallTalk('讲个笑话', noon)?.kind).toBe('joke');
  });

  it('英文和日文也能认', () => {
    expect(detectSmallTalk('hello there', noon)?.kind).toBe('greeting');
    expect(detectSmallTalk('what can you do', noon)?.kind).toBe('capability');
    expect(detectSmallTalk('こんにちは', noon)?.kind).toBe('greeting');
    expect(detectSmallTalk('ありがとう', noon)?.kind).toBe('thanks');
  });

  it('应答、邀请聊天、问助手自己', () => {
    expect(detectSmallTalk('嗯', noon)?.kind).toBe('ack');
    expect(detectSmallTalk('好的', noon)?.kind).toBe('ack');
    expect(detectSmallTalk('原来如此', noon)?.kind).toBe('ack');
    expect(detectSmallTalk('随便聊聊', noon)?.kind).toBe('chatInvite');
    expect(detectSmallTalk('陪我聊会儿', noon)?.kind).toBe('chatInvite');
    expect(detectSmallTalk('你在干嘛', noon)?.kind).toBe('selfState');
    expect(detectSmallTalk('你累不累', noon)?.kind).toBe('selfState');
  });

  it('应答词不会抢走真的记账话', () => {
    // 「好」开头的句子很多，只有整句就是一个应答才算
    expect(detectSmallTalk('好，记一笔午饭 25', noon)).toBeNull();
    expect(detectSmallTalk('对，这个月花了多少', noon)).toBeNull();
    expect(detectSmallTalk('行，帮我记 30 打车', noon)).toBeNull();
  });

  it('真正听不懂的话仍然返回 null，交给云端或兜底', () => {
    expect(detectSmallTalk('把冰箱搬到楼上去', noon)).toBeNull();
    expect(detectSmallTalk('蓝色和红色哪个好', noon)).toBeNull();
  });
});
