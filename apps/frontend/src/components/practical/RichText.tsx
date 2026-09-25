import { clsx } from 'clsx';
import { parseInline, toBlocks } from '../../lib/practical';

/** Строка с **выделением** → <strong>, без литералов markdown. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) => (p.strong ? <strong key={i} className="font-semibold">{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/**
 * Многострочный текст (сценарий, реплика тьютора): абзацы, маркированные и нумерованные
 * пункты. Символы разметки (**, #, -, >) в интерфейс не попадают.
 */
export function RichText({ text, className, paragraphClassName }: { text: string; className?: string; paragraphClassName?: string }) {
  const blocks = toBlocks(text);
  const groups: { type: 'p' | 'ul' | 'ol'; items: typeof blocks }[] = [];
  for (const b of blocks) {
    const type = b.type === 'p' ? 'p' : b.type === 'li' ? 'ul' : 'ol';
    const last = groups[groups.length - 1];
    if (type !== 'p' && last?.type === type) last.items.push(b);
    else groups.push({ type, items: [b] });
  }
  return (
    <div className={clsx('space-y-2.5', className)}>
      {groups.map((g, i) => {
        if (g.type === 'p') {
          return (
            <p key={i} className={paragraphClassName}>
              <Inline text={g.items[0]!.text} />
            </p>
          );
        }
        const List = g.type === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i} className={clsx('space-y-1 pl-5', g.type === 'ul' ? 'list-disc' : 'list-decimal', 'marker:text-fg-2')} start={g.type === 'ol' ? g.items[0]!.n : undefined}>
            {g.items.map((it, j) => (
              <li key={j} className="pl-1">
                <Inline text={it.text} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
