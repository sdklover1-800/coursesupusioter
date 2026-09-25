/**
 * Дизайн-система «Inquiry 2.0» — единая точка импорта примитивов.
 * Реализация — components/primitives/*.tsx; иконки — components/icons.tsx.
 * Все прежние экспорты (Button, buttonClass, Input, Textarea, Select, Field, Card, Badge,
 * Spinner, Skeleton, QuestionGlyph, InquiryMeter, toast, ToastHost, Dialog, useTheme) сохранены.
 */
export { Button, buttonClass, type ButtonSize, type ButtonVariant } from './primitives/Button';
export { Input, Textarea, Select, Field, Card } from './primitives/forms';
export { Spinner, Skeleton, toast, ToastHost, type ToastOptions, type ToastTone } from './primitives/feedback';
export { Badge, ModeBadge, QuestionGlyph, Kbd, type BadgeTone, type LearningMode } from './primitives/badges';
export { StatusIcon, KindIcon, TimeChip, type StatusState } from './primitives/status';
export { ProgressRing, RubricBars, InquiryMeter } from './primitives/meters';
export { Tabs, TabPanel, SegmentedControl, Breadcrumb, type TabItem, type SegmentOption, type Crumb } from './primitives/nav';
export { Dialog, Sheet, ConfirmDialog, Menu, useModalBehavior, type MenuItem } from './primitives/overlay';
export { Icon, type IconName } from './icons';

/* ── Тема (свет/тьма) и режим для слабовидящих — lib/theme.ts ── */
export { useTheme, useA11yMode } from '../lib/theme';
