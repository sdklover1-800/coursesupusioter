import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import type { ItemState, LearnItemKind } from '@edu/shared';
import {
  Badge, Breadcrumb, Button, Card, ConfirmDialog, Dialog, Field, InquiryMeter, Input, KindIcon, Kbd, Menu, ModeBadge,
  ProgressRing, QuestionGlyph, RubricBars, SegmentedControl, Select, Sheet, Skeleton, Spinner, StatusIcon, TabPanel, Tabs,
  Textarea, TimeChip, toast, type BadgeTone, type ButtonVariant,
} from '../../components/ui';
import { MeterBar, PageHeader, StatCard } from '../../components/page';
import { Icon, ICON_NAMES } from '../../components/icons';
import { A11yToggle, LanguageSwitcher, LogoMark, ThemeToggle } from '../../components/AppShell';
import { ReportIssueButton } from '../../components/ReportIssue';
import { useFormat } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Витрина примитивов Inquiry 2.0 (/__ui, ТОЛЬКО dev): каждый примитив в каждом состоянии.
 * data-probe — узлы для проверки контраста (A24) и шрифтов (A18) скриптами puppeteer.
 * Подписи витрины — служебные (не переводятся); тексты примитивов — из пространства ui.
 */
const KK = 'әғқңөұүһі ӘҒҚҢӨҰҮҺІ';
const TONES: BadgeTone[] = ['brand', 'ink', 'spark', 'teal', 'danger', 'muted'];
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'spark'];
const STATES: (ItemState | 'NEXT')[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'PASSED', 'FAILED', 'LOCKED', 'NEXT'];
const KINDS: LearnItemKind[] = ['LECTURE', 'MINI_QUIZ', 'MODULE_QUIZ', 'PRACTICAL', 'FINAL_MINI_QUIZ', 'CERTIFICATE'];

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-4">
      <h2 className="font-display text-display-lg">{title}</h2>
      {children}
    </section>
  );
}
function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-3', className)}>
      {label && <span className="eyebrow w-40 shrink-0">{label}</span>}
      {children}
    </div>
  );
}

export default function UiShowcase() {
  useDocumentTitle('UI');
  const fmt = useFormat();
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [seg, setSeg] = useState<'day' | 'week' | 'all'>('week');
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetBottom, setSheetBottom] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [used, setUsed] = useState(17);
  const [active, setActive] = useState(62);

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 sm:px-6 lg:px-8">
          <LogoMark size={28} />
          <span className="eyebrow ml-2 hidden sm:inline">Inquiry 2.0 · UI</span>
          <div className="flex-1" />
          <LanguageSwitcher variant="responsive" />
          <A11yToggle />
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1200px] space-y-12 px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader eyebrow="Design system" title="Inquiry 2.0" subtitle="Geologica · Onest · IBM Plex Mono — Kazakh-safe" />

        <Section title="Типографика">
          <Card className="space-y-3">
            <div className="font-display text-display-2xl" data-probe="font">83%</div>
            <h1 id="probe-h1" className="font-display text-display-xl">{KK}</h1>
            <h2 className="font-display text-display-lg">Модуль II · Саясат теориясы</h2>
            <div className="font-display text-display-md">IV · display-md</div>
            <h3 id="probe-title" className="text-title">{KK}</h3>
            <p className="text-body-lg">Оқу — дұрыс сұрақ қою деген сөз. Учиться — значит задавать правильные вопросы.</p>
            <p id="probe-body" className="text-body">{KK}</p>
            <p className="text-meta text-fg-2">Мета-жол: Қазақ тілі · 5 модуль · 15 дәріс · ≈ 6 сағ (meta / fg-2)</p>
            <p className="text-small text-muted">Қосымша мәтін — small / muted (тек міндетті емес кеңестер)</p>
            <div id="probe-eyebrow" className="eyebrow">{KK}</div>
            <div className="eyebrow">Модуль II · Дәріс 7 (.eyebrow = label, sentence case)</div>
            <div id="probe-mono" className="num">{KK}</div>
            <div className="num text-fg-2">12:40 · 18/24 · 6 / 8 · EO-2026-000123 (.num)</div>
            <p className="transcript max-w-[68ch] text-transcript">
              Сократтық әдіс — сұрақтар арқылы ойлауды дамыту. Тьютор дайын жауап бермейді: ол сізді дәлелдер мен қорытындыға жетелейді.
            </p>
          </Card>
        </Section>

        <Section title="Кнопки">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Row key={size} label={`size ${size}`}>
              {VARIANTS.map((v) => (
                <Button key={v} variant={v} size={size} data-probe={size === 'md' ? `btn-${v}` : undefined}>
                  {v === 'spark' ? 'Начать диалог' : v === 'danger' ? 'Удалить' : 'Продолжить'}
                </Button>
              ))}
            </Row>
          ))}
          <Row label="states">
            <Button loading>Сохранение</Button>
            <Button disabled>Недоступно</Button>
            <Button variant="secondary" loading>Загрузка</Button>
          </Row>
        </Section>

        <Section title="Плашки, режимы, таймкоды">
          {[
            { label: 'on card', cls: 'bg-card', key: 'card' },
            { label: 'on brand-soft', cls: 'bg-brand-soft', key: 'soft' },
            { label: 'on surface', cls: 'bg-surface', key: 'surface' },
          ].map((ground) => (
            <div key={ground.key} className={clsx('space-y-3 rounded-xl border border-border p-4', ground.cls)}>
              <Row label={ground.label}>
                {TONES.map((tn) => (
                  <span key={tn} data-probe={`badge-${tn}-${ground.key}`}>
                    <Badge tone={tn}>{tn} · Қазақша</Badge>
                  </span>
                ))}
              </Row>
              <Row label="ModeBadge">
                <span data-probe={`mode-practice-${ground.key}`}><ModeBadge mode="practice" /></span>
                <span data-probe={`mode-practice-long-${ground.key}`}><ModeBadge mode="practice" long /></span>
                <span data-probe={`mode-graded-${ground.key}`}><ModeBadge mode="graded" /></span>
              </Row>
              <Row label="TimeChip">
                <span data-probe={`time-${ground.key}`}><TimeChip seconds={754} /></span>
                <span data-probe={`time-active-${ground.key}`}><TimeChip seconds={1320} active /></span>
                <TimeChip seconds={3725} onClick={() => toast('seek 1:02:05')} />
                <TimeChip label={fmt.formatDuration(4800, 'human')} />
              </Row>
            </div>
          ))}
        </Section>

        <Section title="Текстовые токены (контраст)">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: 'card', cls: 'bg-card' },
              { key: 'surface', cls: 'bg-surface' },
            ].map((g) => (
              <div key={g.key} className={clsx('space-y-1 rounded-xl border border-border p-4', g.cls)}>
                {['text-fg', 'text-fg-2', 'text-muted', 'text-brand', 'text-spark-ink', 'text-teal-ink', 'text-danger-ink'].map((c) => (
                  <div key={c} className={clsx('text-sm font-medium', c)} data-probe={`${c}-${g.key}`}>
                    {c} — Мәтін үлгісі
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Состояния и типы">
          <Card className="space-y-4">
            <Row label="StatusIcon">
              {STATES.map((s) => <StatusIcon key={s} state={s} progress={s === 'IN_PROGRESS' ? 0.4 : undefined} withLabel />)}
            </Row>
            <Row label="size 24">
              {STATES.map((s) => <StatusIcon key={s} state={s} size={24} progress={0.7} />)}
            </Row>
            <Row label="KindIcon">
              {KINDS.map((k) => <KindIcon key={k} kind={k} />)}
            </Row>
            <Row label="done">
              {KINDS.map((k) => <KindIcon key={k} kind={k} done />)}
            </Row>
            <Row label="current / 20px">
              {KINDS.map((k) => <KindIcon key={k} kind={k} current size={20} />)}
            </Row>
            <Row label="QuestionGlyph">
              <QuestionGlyph size={24} />
              <QuestionGlyph size={40} />
              <QuestionGlyph size={56} />
            </Row>
          </Card>
        </Section>

        <Section title="Прогресс и измерители">
          <Card className="space-y-6">
            <Row label="ProgressRing">
              <ProgressRing value={0} />
              <ProgressRing value={0.42} />
              <ProgressRing value={1} tone="teal" />
              <ProgressRing value={0.75} size={96} stroke={8} />
              <ProgressRing value={0.3} size={24} stroke={3} />
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <MeterBar value={0.64} label="brand" />
              <MeterBar value={0.4} tone="spark" label="spark" />
              <MeterBar value={0.9} tone="teal" label="teal" />
              <MeterBar value={0.2} tone="danger" label="danger" />
            </div>
            <RubricBars
              scores={{ methodicalness: 2.4, question_quality: 1.8, logical_progression: 3, self_correction: 1.2 }}
              lines={{ question_quality: 'Уточняющие вопросы появлялись, но поздно.' }}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="eyebrow">InquiryMeter · {used}/24</div>
                <InquiryMeter used={used} max={24} />
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setUsed((u) => Math.max(0, u - 1))}>−1</Button>
                  <Button size="sm" variant="secondary" onClick={() => setUsed((u) => Math.min(24, u + 1))}>+1</Button>
                </div>
              </div>
              <div className="space-y-3">
                <InquiryMeter used={21} max={24} />
                <InquiryMeter used={23} max={24} />
                <InquiryMeter used={24} max={24} />
              </div>
              <InquiryMeter used={12} max={40} />
              <Row label="compact">
                <InquiryMeter used={5} max={24} compact />
                <InquiryMeter used={22} max={24} compact />
              </Row>
            </div>
          </Card>
        </Section>

        <Section title="Навигация">
          <Card className="space-y-5">
            <Breadcrumb items={[{ label: 'Мои курсы', to: '/' }, { label: 'Политология', to: '/' }, { label: 'II. Саясат теориясы', to: '/' }, { label: 'Лекция 6' }]} />
            <Tabs
              idPrefix="demo"
              ariaLabel="Демо"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'a', label: 'Расшифровка' },
                { id: 'b', label: 'Конспект', badge: 3 },
                { id: 'c', label: 'Термины', disabled: true },
              ]}
            />
            <TabPanel idPrefix="demo" id={tab} className="text-sm text-muted">Панель «{tab}»</TabPanel>
            <Row label="Segmented">
              <SegmentedControl
                ariaLabel="Период"
                value={seg}
                onChange={setSeg}
                options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'all', label: 'Всё время' }]}
              />
              <SegmentedControl ariaLabel="brand" tone="brand" size="sm" value={seg} onChange={setSeg} options={[{ value: 'day', label: 'A' }, { value: 'week', label: 'B' }, { value: 'all', label: 'C' }]} />
              <LanguageSwitcher />
            </Row>
            <Row label="Kbd">
              <span className="text-sm text-muted">
                <Kbd>1</Kbd>–<Kbd>4</Kbd> выбор · <Kbd>Enter</Kbd> проверить · <Kbd>Esc</Kbd> закрыть
              </span>
            </Row>
          </Card>
        </Section>

        <Section title="Оверлеи и действия">
          <Card className="space-y-4">
            <Row label="open">
              <Button variant="secondary" onClick={() => setDialog(true)}>Dialog</Button>
              <Button variant="secondary" onClick={() => setSheet(true)}>Sheet</Button>
              <Button variant="secondary" onClick={() => setSheetBottom(true)}>Sheet bottom</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>ConfirmDialog</Button>
              <Menu
                align="left"
                triggerLabel="Menu"
                triggerClassName="border border-border bg-card px-3"
                trigger={<span className="inline-flex items-center gap-1 text-sm font-semibold">Menu <Icon name="chevron-down" size={16} /></span>}
                items={[
                  { key: 'a', label: 'Қазақша', lang: 'kk', checked: true, onSelect: () => undefined },
                  { key: 'b', label: 'Русский', lang: 'ru', checked: false, onSelect: () => undefined },
                  { key: 'c', label: 'Выход', icon: 'logout', danger: true, onSelect: () => undefined },
                ]}
              />
            </Row>
            <Row label="Report">
              <ReportIssueButton targetType="QUIZ_QUESTION" targetId="demo" context="PRACTICE" />
              <ReportIssueButton targetType="CHAT_MESSAGE" targetId="demo" context="PRACTICAL" compact />
            </Row>
            <Row label="Toast">
              <Button size="sm" variant="secondary" onClick={() => toast('Сохранено')}>brand</Button>
              <Button size="sm" variant="secondary" onClick={() => toast('Готово', 'teal')}>teal</Button>
              <Button size="sm" variant="secondary" onClick={() => toast('Не удалось сохранить', 'danger')}>danger</Button>
              <Button size="sm" variant="secondary" onClick={() => toast('Продолжаем с 12:40', 'brand', { action: { label: 'С начала', onClick: () => undefined } })}>action</Button>
            </Row>
            <Row label="Loading">
              <Spinner className="h-5 w-5 text-brand" />
              <Skeleton className="h-8 w-48" />
            </Row>
          </Card>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Отправить официальную попытку?"
            description="Изменить ответы после отправки нельзя."
            footer={<><Button variant="secondary" onClick={() => setDialog(false)}>Отмена</Button><Button onClick={() => setDialog(false)}>Отправить</Button></>}
          >
            <Field label="Комментарий"><Input placeholder="…" /></Field>
          </Dialog>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Разделы лекции" description="12 разделов">
            <ul className="space-y-2">
              {Array.from({ length: 12 }, (_, i) => (
                <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-brand-soft">
                  <TimeChip seconds={i * 95} active={i === 3} />
                  <span className="text-sm">Раздел {i + 1}</span>
                </li>
              ))}
            </ul>
          </Sheet>
          <Sheet open={sheetBottom} onClose={() => setSheetBottom(false)} title="Ещё" side="bottom">
            <p className="text-sm text-muted">Нижний лист на любой ширине.</p>
          </Sheet>
          <ConfirmDialog
            open={confirm}
            title="Удалить лекцию?"
            body="Прогресс студентов по ней будет потерян."
            confirmLabel="Удалить"
            tone="danger"
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
          />
        </Section>

        <Section title="Поверхности">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="surface-practice space-y-3 p-5">
              <ModeBadge mode="practice" long />
              <div className="text-title">Тренировка по модулю</div>
              {['A', 'B', 'C'].map((l, i) => (
                <button key={l} type="button" className={clsx('lip flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-4 text-left text-body', i === 1 ? 'border-brand bg-brand-soft !border-b-brand' : 'border-border bg-card')}>
                  <span className="grid h-8 w-8 place-items-center rounded-md border border-border font-mono text-sm">{l}</span>
                  Вариант ответа {l}
                </button>
              ))}
            </div>
            <div className="stage overflow-hidden rounded-2xl p-5">
              <div data-theme="dark" className="space-y-3 text-fg">
                <div className="eyebrow">Stage · data-theme=dark</div>
                <div className="grid aspect-video place-items-center rounded-xl bg-black/40"><Icon name="play" size={40} fill="currentColor" /></div>
                <div className="flex flex-wrap gap-2">
                  <TimeChip seconds={120} /><TimeChip seconds={480} active /><ModeBadge mode="graded" /><Badge tone="spark">spark</Badge>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Студенты" value={128} tone="brand" />
            <StatCard label="Сдали" value="74%" tone="teal" />
            <StatCard label="Сертификаты" value={41} tone="spark" />
          </div>
        </Section>

        <Section title="Формы">
          <Card className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" hint="Подсказка"><Input placeholder="name@esil.edu.kz" /></Field>
            <Field label="Роль" error="Обязательное поле"><Select><option>Студент</option></Select></Field>
            <div className="sm:col-span-2"><Field label="Комментарий"><Textarea placeholder="…" /></Field></div>
          </Card>
        </Section>

        <Section title="Иконки">
          <Card>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8">
              {ICON_NAMES.map((n) => (
                <div key={n} className="flex flex-col items-center gap-1.5 rounded-lg p-2 text-center">
                  <Icon name={n} size={24} />
                  <span className="font-mono text-xs text-fg-2">{n}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Section title="Форматирование">
          <Card className="space-y-1 font-mono text-sm">
            <div>formatDate: {fmt.formatDate('2026-09-25T10:30:00Z')} · {fmt.formatDate('2026-09-25T10:30:00Z', 'long')} · {fmt.formatDate('2026-09-25T10:30:00Z', 'datetime')}</div>
            <div>formatDuration: {fmt.formatDuration(1320)} · {fmt.formatDuration(4800, 'human')} · {fmt.formatDuration(45, 'human')}</div>
            <div>formatCountdown: {fmt.formatCountdown(new Date(Date.now() + 23 * 3600e3 + 41 * 60e3).toISOString())}</div>
            <div>formatPercent: {fmt.formatPercent(0.834)} · formatNumber: {fmt.formatNumber(1234567)}</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setActive((a) => (a + 5) % 100)}>ring {active}%</Button>
              <ProgressRing value={active / 100} size={40} />
            </div>
          </Card>
        </Section>
      </main>
    </div>
  );
}
