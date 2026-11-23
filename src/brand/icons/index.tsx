import type { ComponentType } from "react";
import { Icon, Spark, type IconProps } from "./Icon";

export { Icon, Spark, sparkPath, ICON_GRID, ICON_STROKE, type IconProps } from "./Icon";

/**
 * The Skot corner: every rounded rectangle is drawn as one stroke that starts left
 * of the top-left corner (the top edge overshoots by `over`) and ends on the left
 * edge `gap` below the radius tangent, so that corner is never closed.
 */
export function sketchRect(x: number, y: number, w: number, h: number, r = 2, over = 2, gap = 1): string {
  return (
    `M${x - over} ${y}H${x + w - r}a${r} ${r} 0 0 1 ${r} ${r}` +
    `V${y + h - r}a${r} ${r} 0 0 1 -${r} ${r}` +
    `H${x + r}a${r} ${r} 0 0 1 -${r} -${r}V${y + r + gap}`
  );
}

export function IconSelect(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5.9V18.6l4.1-3.8 2.7 5.6 2.4-1.1-2.6-5.5 5.7-.3L3.9 3.1" />
    </Icon>
  );
}

export function IconHand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 11.5V5.4M12 10.5V3.9M15 10.5V5.4" />
      <path d="M18 8v6.4a5.6 5.6 0 0 1-5.6 5.6h-1a5.2 5.2 0 0 1-4-1.9l-2.9-3.6a1.45 1.45 0 0 1 2.2-1.9L9 15V11.5" />
    </Icon>
  );
}

export function IconBox(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 5, 16, 14)} />
    </Icon>
  );
}

export function IconDiamond(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.6 5.1 20.5 12 12 20.5 3.5 12l9.9-9.9" />
    </Icon>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6a7 2.5 0 0 1 14 0 7 2.5 0 0 1-14 0" />
      <path d="M5 4.4V18a7 2.5 0 0 0 14 0V6" />
      <path d="M5 12a7 2.5 0 0 0 14 0" />
    </Icon>
  );
}

export function IconActor(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.4 5.45A8 8 0 1 1 4 12V7.4" />
    </Icon>
  );
}

export function IconArrow(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 19.5C7 13 11.5 8.5 18.5 5.5" />
      <path d="M12.6 4.4l5.9 1.1-1.6 5.8" />
    </Icon>
  );
}

export function IconFrame(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 8h19M2.5 16h19M8 2.5v19M16 2.5v19" />
    </Icon>
  );
}

export function IconPen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 17.5l.8-3.7 9.3-9.3a2.1 2.1 0 0 1 3 3l-9.3 9.3z" />
      <path d="M4.3 13.8l2.9 2.9" />
      <path d="M11 20c1.4-1.3 2.9-1.4 4-.3s2.7 1 4.5-.7" />
    </Icon>
  );
}

export function IconText(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 5H19v2.2M5 5v2.2M12 5v14M9.5 19h5" />
    </Icon>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 5 4 9.5 8.5 14" />
      <path d="M4 9.5h10.5a5 5 0 0 1 0 10H11" />
    </Icon>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.5 5 20 9.5 15.5 14" />
      <path d="M20 9.5H9.5a5 5 0 0 0 0 10H13" />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M4.5 12H19" />
    </Icon>
  );
}

export function IconMinus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12H19" />
    </Icon>
  );
}

export function IconFit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4H7M4 4v4.5M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </Icon>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 14.5A8.2 8.2 0 1 1 9.5 4.5a7.5 7.5 0 0 0 10 10z" />
    </Icon>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </Icon>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
    </Icon>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
    </Icon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 7H20" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6 7l.9 11.2a2 2 0 0 0 2 1.8h6.2a2 2 0 0 0 2-1.8L18 7" />
      <path d="M10 11v5M14 11v5" />
    </Icon>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(9, 9, 11, 11)} />
      <path d="M15.5 6V5.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h.5" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12.8l4.6 4.6L20 6" />
    </Icon>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </Icon>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12h16M13.5 6l6 6-6 6" />
    </Icon>
  );
}

export function IconArrowLeftRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8H19M15.5 4.5 19 8l-3.5 3.5" />
      <path d="M20.5 16H5M8.5 12.5 5 16l3.5 3.5" />
    </Icon>
  );
}

export function IconEnter(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 4V11a3 3 0 0 1-3 3h-12M9 9.5 4.5 14 9 18.5" />
    </Icon>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 5.5Q11.9 11.6 18 13q-6.1 1.4-7.5 7.5Q9.1 14.4 3 13q6.1-1.4 7.5-7.5z" />
      <Spark cx={18.5} cy={5} r={3} />
    </Icon>
  );
}

export function IconWand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 20.5 13.5 10.5M11.8 8.8l3.4 3.4" />
      <Spark cx={17.5} cy={6.5} r={3.6} />
      <Spark cx={10.5} cy={4} r={1.7} />
      <Spark cx={20} cy={13.5} r={1.7} />
    </Icon>
  );
}

export function IconFork(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="17.5" cy="5.5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M12 17v-3.5c0-3-5.5-2.8-5.5-6M12 13.5c0-3 5.5-2.8 5.5-6" />
    </Icon>
  );
}

export function IconBranch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.5" cy="18" r="2" />
      <circle cx="17.5" cy="6" r="2" />
      <path d="M6.5 3.5V16M17.5 8v.5a5 5 0 0 1-5 5H9a2.5 2.5 0 0 0-2.5 2.5" />
    </Icon>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4.44 20.5 7.5 12 11.5 3.5 7.5l10.31-4.85" />
      <path d="M3.5 12 12 16l8.5-4M3.5 16.5 12 20.5l8.5-4" />
    </Icon>
  );
}

export function IconSpinner(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
    </Icon>
  );
}

export function IconCpu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(6, 6, 12, 12)} />
      <path d="M9.5 2.8V6M14.5 2.8V6M9.5 18v3.2M14.5 18v3.2M2.8 9.5H6M2.8 14.5H6M18 9.5h3.2M18 14.5h3.2" />
      <Spark cx={12} cy={12} r={3} />
    </Icon>
  );
}

export function IconScale(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v16M8.5 20h7M5 8.5l14-2.5" />
      <path d="M2.5 14.5 5 8.5l2.5 6M2.5 14.5a2.5 2.5 0 0 0 5 0" />
      <path d="M16.5 12 19 6l2.5 6M16.5 12a2.5 2.5 0 0 0 5 0" />
    </Icon>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Icon>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20v-1a4.5 4.5 0 0 1 4.5-4.5h3A4.5 4.5 0 0 1 15 19v1" />
      <path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.6A4.5 4.5 0 0 1 21 19v1" />
    </Icon>
  );
}

export function IconBroadcast(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12" />
    </Icon>
  );
}

export function IconWifi(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M8.5 15a5 5 0 0 1 7 0M5.5 11.8a9.2 9.2 0 0 1 13 0M2.5 8.6a13.5 13.5 0 0 1 19 0" />
    </Icon>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4.5" />
      <path d="M13.5 3.5h7v7M20.5 3.5l-9 9" />
    </Icon>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.3 4.6a2 2 0 0 1 3.4 0l7.3 12.6a2 2 0 0 1-1.7 3H4.7a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.9" r="1.05" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconReset(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9" />
    </Icon>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
      <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12 15.1l-3.6.9.9-3.6z" />
    </Icon>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(5, 11, 14, 9.5)} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </Icon>
  );
}

export function IconUnlock(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(5, 11, 14, 9.5)} />
      <path d="M8 11V8a4 4 0 0 1 7.7-1.5M12 14.5v2.5" />
    </Icon>
  );
}

export function IconGroup(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 4, 16, 16)} />
      <rect x="7" y="7" width="5.5" height="5.5" rx="1.25" />
      <circle cx="15" cy="15" r="2.6" />
    </Icon>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 5, 16, 14)} />
      <circle cx="9" cy="9.6" r="1.5" />
      <path d="M4.5 16.6l4.2-4.2a1 1 0 0 1 1.4 0l3.9 3.9 1.8-1.8a1 1 0 0 1 1.4 0l2.6 2.6" />
    </Icon>
  );
}

export function IconAlignCenter(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 6H20M7 10h10M4 14h16M8 18h8" />
    </Icon>
  );
}

/**
 * Skot mark: one quick pen stroke forming an S, flicked off at the tail, with the
 * spark where the pen landed. Drawn in currentColor; heavier stroke because it sits
 * at ~18px inside the 28px terracotta header tile.
 */
export function SkotMark({ strokeWidth = 2.4, ...props }: IconProps) {
  return (
    <Icon strokeWidth={strokeWidth} {...props}>
      <path d="M15.6 7.4C14.2 5.6 12.3 5 10.4 5.3 8.3 5.6 6.8 7 7 8.9c.3 2.4 3.4 2.8 5.4 3.4 2.4.7 4.4 1.7 4.3 4.1-.1 2.2-2.4 3.2-4.9 3.1-2.3-.1-4.2-1-5.4-2.6l-1 .9" />
      <Spark cx={19} cy={4.6} r={3} />
    </Icon>
  );
}

export function IconShapes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 13.5, 7, 7)} />
      <circle cx="17" cy="7" r="3.5" />
      <path d="M7.5 3.5 11 10H4z" />
      <path d="M17 13.5v7M13.5 17h7" />
    </Icon>
  );
}

export function IconQueue(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(3, 7, 18, 10)} />
      <path d="M8 7v10M12 7v10M16 7v10" />
    </Icon>
  );
}

export function IconCache(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 4, 16, 16)} />
      <path d="M13.2 7 9.5 12.6h5L10.8 17" />
    </Icon>
  );
}

export function IconLoadBalancer(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12h4.5" />
      <circle cx="9.5" cy="12" r="2.5" />
      <path d="M11.6 10.6 18 6M12 12h6.5M11.6 13.4 18 18" />
      <circle cx="20" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="20" cy="18.5" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconBlob(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5a8 2.3 0 0 1 16 0 8 2.3 0 0 1-16 0" />
      <path d="M4 6.5l1.9 11.8a6.1 2 0 0 0 12.2 0L20 6.5" />
    </Icon>
  );
}

export function IconExternalSystem(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 18.5H17a3.6 3.6 0 0 0 .5-7.2 5.6 5.6 0 0 0-10.7-1.5 4.4 4.4 0 0 0 .7 8.7z" />
    </Icon>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5.5" r="2.5" />
      <path d="M12 8v7M7 11h10M12 15l-4 5.5M12 15l4 5.5" />
    </Icon>
  );
}

export function IconZone(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(3, 4, 18, 16)} strokeDasharray="2.5 2.5" />
      <path d="M6.5 8h5" />
    </Icon>
  );
}

export function IconEntity(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 4, 16, 16)} />
      <path d="M4 9h16M7 12.8h10M7 16.3h6.5" />
    </Icon>
  );
}

export function IconClass(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(4, 3.5, 16, 17)} />
      <path d="M4 8.5h16M4 14h16" />
    </Icon>
  );
}

export function IconActivation(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.5V6M12 18v3.5" strokeDasharray="1.5 2.2" />
      <rect x="9.5" y="6" width="5" height="12" rx="1" />
    </Icon>
  );
}

export function IconFragment(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(3, 4, 18, 16)} />
      <path d="M3 9.5h5.5L10.5 7.5V4" />
      <path d="M3.5 14.5h17" strokeDasharray="2 2.5" />
    </Icon>
  );
}

export function IconApiCard(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(3, 4.5, 18, 15)} />
      <path d="M3 9.5h18M9 9.5v10" />
      <path d="M5.5 7h2.5M11.5 13h6.5M11.5 16.5h4" />
    </Icon>
  );
}

export function IconNoteCard(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4h11.5L20 8.5V20H4z" />
      <path d="M15.5 4v4.5H20" />
      <path d="M7 12h7M7 15.5h9" />
    </Icon>
  );
}

export function IconMarkdown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(2.5, 4.5, 19, 15)} />
      <path d="M6 15.5v-7l3 3.8 3-3.8v7" />
      <path d="M16.5 8.5v7M14.3 13.2l2.2 2.3 2.2-2.3" />
    </Icon>
  );
}

export function IconSequence(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5v17M18 3.5v17" strokeDasharray="1.6 2.2" />
      <path d="M6 9h11M14.5 6.5 17 9l-2.5 2.5" />
      <path d="M18 15H7" strokeDasharray="2 1.8" />
      <path d="M9.5 12.5 7 15l2.5 2.5" />
    </Icon>
  );
}

export function IconStateMachine(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="3.8" cy="12" r="1.6" fill="currentColor" />
      <rect x="7" y="9" width="6" height="6" rx="2.2" />
      <path d="M5.5 12H7M13 12h3.2M14.6 10.4 16.2 12l-1.6 1.6" />
      <circle cx="19.5" cy="12" r="2.2" />
      <circle cx="19.5" cy="12" r="0.9" fill="currentColor" />
    </Icon>
  );
}

export function IconEstimate(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(5, 3, 14, 18)} />
      <path d="M8 7h8" />
      <path d="M8.5 11.5h1M12 11.5h1M15.5 11.5h0.5M8.5 15h1M12 15h1M15.5 15h0.5M8.5 18h1M12 18h4" />
    </Icon>
  );
}

export function IconPacks(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(3.5, 3.5, 7.5, 7.5)} />
      <path d="M17 3.5l3.8 3.8-3.8 3.8-3.8-3.8z" />
      <circle cx="7.25" cy="16.75" r="3.75" />
      <path d="M13.5 13.5h7v7h-7z" strokeDasharray="2 1.8" />
    </Icon>
  );
}

export function IconSlash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(3, 3, 18, 18)} />
      <path d="M14.5 7l-5 10" />
    </Icon>
  );
}

/** Moves: a knight's L-step ending in the AI spark. */
export function IconMoves(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 20V9.5a2 2 0 0 1 2-2h7" />
      <path d="M11.5 4.5 14.5 7.5 11.5 10.5" />
      <Spark cx={18.5} cy={16.5} r={3.5} />
    </Icon>
  );
}

/** Breaks at 10×: a cylinder with a crack through it. */
export function IconBreak(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6a7 2.5 0 0 1 14 0 7 2.5 0 0 1-14 0" />
      <path d="M5 4.4V18a7 2.5 0 0 0 14 0V6" />
      <path d="M13 9.5l-2.5 3.5 3 1.5-2 4" />
    </Icon>
  );
}

/** Trace request: numbered stops on a path with a pulse. */
export function IconTrace(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 18.5h5a3 3 0 0 0 3-3v-7a3 3 0 0 1 3-3h4" />
      <circle cx={4.5} cy={18.5} r={1.6} />
      <circle cx={12.5} cy={12} r={2.4} fill="currentColor" stroke="none" />
      <path d="M17.5 3.5 19.5 5.5 17.5 7.5" />
    </Icon>
  );
}

/** API to schema: an endpoint card feeding a table with a key row. */
export function IconApiToSchema(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(2.5, 4, 8, 6, 1.5)} />
      <path d="M5 7h3" />
      <path d="M6.5 10v4.5h4" />
      <path d={sketchRect(11.5, 10.5, 10, 10, 1.5)} />
      <path d="M11.5 14h10M14.5 14v6.5" />
    </Icon>
  );
}

/** Failure step: an arrow broken by a retry loop. */
export function IconFailureStep(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h5" />
      <path d="M16 12h5M18.5 9.5 21 12l-2.5 2.5" />
      <path d="M14.5 9.2A3.5 3.5 0 1 0 15 13" />
      <path d="M14.8 6.8v2.6h-2.6" />
    </Icon>
  );
}

/** Missing transitions: two states and a dashed, still-ghost transition. */
export function IconMissingTransition(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(2.5, 4, 8, 5.5, 2.5)} />
      <path d={sketchRect(13.5, 14.5, 8, 5.5, 2.5)} />
      <path d="M6.5 9.5v4.5a3 3 0 0 0 3 3h1.5" strokeDasharray="1.6 2.4" />
      <path d="M17.5 4v6M14.5 7h6" />
    </Icon>
  );
}

/** Consistency: three linked boxes and a check. */
export function IconConsistency(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(2.5, 3, 7, 5, 1.5)} />
      <path d={sketchRect(14.5, 3, 7, 5, 1.5)} />
      <path d={sketchRect(8.5, 16, 7, 5, 1.5)} />
      <path d="M9.5 5.5h5M6 8l4 8M18 8l-4 8" />
    </Icon>
  );
}

export function IconInitialState(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="5.5" fill="currentColor" />
    </Icon>
  );
}

export function IconFinalState(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconEndNone(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h18" />
    </Icon>
  );
}

export function IconEndArrow(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h11" />
      <path d="M14 7.5 21 12l-7 4.5z" fill="currentColor" />
    </Icon>
  );
}

export function IconEndOpen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h17.5M15 7l6 5-6 5" />
    </Icon>
  );
}

export function IconEndTriangle(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h11" />
      <path d="M14 7l7 5-7 5z" />
    </Icon>
  );
}

export function IconEndDiamond(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h8" />
      <path d="M11 12l5-4 5 4-5 4z" fill="currentColor" />
    </Icon>
  );
}

export function IconEndOpenDiamond(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h8" />
      <path d="M11 12l5-4 5 4-5 4z" />
    </Icon>
  );
}

export function IconEndOne(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h18M16 7v10" />
    </Icon>
  );
}

export function IconEndOnlyOne(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h18M14 7v10M18 7v10" />
    </Icon>
  );
}

export function IconEndZeroOne(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h6.5M14.5 12H21M18 7v10" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  );
}

export function IconEndMany(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h18M15 12l6-5M15 12l6 5" />
    </Icon>
  );
}

export function IconEndOneMany(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h18M16 12l5-5M16 12l5 5M12.5 7v10" />
    </Icon>
  );
}

export function IconEndZeroMany(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h5.5M13.5 12H21M16 12l5-5M16 12l5 5" />
      <circle cx="11" cy="12" r="2.5" />
    </Icon>
  );
}

export function IconTimer(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6a7.5 7.5 0 1 1-6.5 3.75" />
      <path d="M10 2.75h4M12 2.75V6M12 13.5V9.75M18.25 7.25l1.5-1.5" />
    </Icon>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5.5v13M15 5.5v13" />
    </Icon>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 6.9V18.5l11-6.5L6.6 4.9" />
    </Icon>
  );
}

export function IconStop(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(6, 6, 12, 12, 2.5)} />
    </Icon>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5a8.5 8.5 0 1 1-7.4 4.3" />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="12" cy="12" r="0.75" />
    </Icon>
  );
}

export function IconReview(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={sketchRect(5, 4.5, 14, 16.5)} />
      <path d="M9.5 3h5v3h-5zM8.75 13.25l2.25 2.25 4.5-4.75" />
    </Icon>
  );
}

export type IconComponent = ComponentType<IconProps>;

export const ICONS: { name: string; Icon: IconComponent }[] = [
  { name: "IconSelect", Icon: IconSelect },
  { name: "IconHand", Icon: IconHand },
  { name: "IconBox", Icon: IconBox },
  { name: "IconDiamond", Icon: IconDiamond },
  { name: "IconDatabase", Icon: IconDatabase },
  { name: "IconActor", Icon: IconActor },
  { name: "IconArrow", Icon: IconArrow },
  { name: "IconFrame", Icon: IconFrame },
  { name: "IconPen", Icon: IconPen },
  { name: "IconText", Icon: IconText },
  { name: "IconUndo", Icon: IconUndo },
  { name: "IconRedo", Icon: IconRedo },
  { name: "IconPlus", Icon: IconPlus },
  { name: "IconMinus", Icon: IconMinus },
  { name: "IconFit", Icon: IconFit },
  { name: "IconMoon", Icon: IconMoon },
  { name: "IconSun", Icon: IconSun },
  { name: "IconDownload", Icon: IconDownload },
  { name: "IconUpload", Icon: IconUpload },
  { name: "IconTrash", Icon: IconTrash },
  { name: "IconCopy", Icon: IconCopy },
  { name: "IconCheck", Icon: IconCheck },
  { name: "IconClose", Icon: IconClose },
  { name: "IconChevronRight", Icon: IconChevronRight },
  { name: "IconArrowRight", Icon: IconArrowRight },
  { name: "IconArrowLeftRight", Icon: IconArrowLeftRight },
  { name: "IconEnter", Icon: IconEnter },
  { name: "IconSpark", Icon: IconSpark },
  { name: "IconWand", Icon: IconWand },
  { name: "IconFork", Icon: IconFork },
  { name: "IconBranch", Icon: IconBranch },
  { name: "IconLayers", Icon: IconLayers },
  { name: "IconSpinner", Icon: IconSpinner },
  { name: "IconCpu", Icon: IconCpu },
  { name: "IconScale", Icon: IconScale },
  { name: "IconPin", Icon: IconPin },
  { name: "IconUsers", Icon: IconUsers },
  { name: "IconBroadcast", Icon: IconBroadcast },
  { name: "IconWifi", Icon: IconWifi },
  { name: "IconExternal", Icon: IconExternal },
  { name: "IconWarning", Icon: IconWarning },
  { name: "IconReset", Icon: IconReset },
  { name: "IconEdit", Icon: IconEdit },
  { name: "IconLock", Icon: IconLock },
  { name: "IconUnlock", Icon: IconUnlock },
  { name: "IconGroup", Icon: IconGroup },
  { name: "IconImage", Icon: IconImage },
  { name: "IconAlignCenter", Icon: IconAlignCenter },
  { name: "IconShapes", Icon: IconShapes },
  { name: "IconQueue", Icon: IconQueue },
  { name: "IconCache", Icon: IconCache },
  { name: "IconLoadBalancer", Icon: IconLoadBalancer },
  { name: "IconBlob", Icon: IconBlob },
  { name: "IconExternalSystem", Icon: IconExternalSystem },
  { name: "IconUser", Icon: IconUser },
  { name: "IconZone", Icon: IconZone },
  { name: "IconEntity", Icon: IconEntity },
  { name: "IconClass", Icon: IconClass },
  { name: "IconActivation", Icon: IconActivation },
  { name: "IconFragment", Icon: IconFragment },
  { name: "IconInitialState", Icon: IconInitialState },
  { name: "IconFinalState", Icon: IconFinalState },
  { name: "IconApiCard", Icon: IconApiCard },
  { name: "IconNoteCard", Icon: IconNoteCard },
  { name: "IconMarkdown", Icon: IconMarkdown },
  { name: "IconSequence", Icon: IconSequence },
  { name: "IconStateMachine", Icon: IconStateMachine },
  { name: "IconEstimate", Icon: IconEstimate },
  { name: "IconPacks", Icon: IconPacks },
  { name: "IconSlash", Icon: IconSlash },
  { name: "IconMoves", Icon: IconMoves },
  { name: "IconBreak", Icon: IconBreak },
  { name: "IconTrace", Icon: IconTrace },
  { name: "IconApiToSchema", Icon: IconApiToSchema },
  { name: "IconFailureStep", Icon: IconFailureStep },
  { name: "IconMissingTransition", Icon: IconMissingTransition },
  { name: "IconConsistency", Icon: IconConsistency },
  { name: "IconEndNone", Icon: IconEndNone },
  { name: "IconEndArrow", Icon: IconEndArrow },
  { name: "IconEndOpen", Icon: IconEndOpen },
  { name: "IconEndTriangle", Icon: IconEndTriangle },
  { name: "IconEndDiamond", Icon: IconEndDiamond },
  { name: "IconEndOpenDiamond", Icon: IconEndOpenDiamond },
  { name: "IconEndOne", Icon: IconEndOne },
  { name: "IconEndOnlyOne", Icon: IconEndOnlyOne },
  { name: "IconEndZeroOne", Icon: IconEndZeroOne },
  { name: "IconEndMany", Icon: IconEndMany },
  { name: "IconEndOneMany", Icon: IconEndOneMany },
  { name: "IconEndZeroMany", Icon: IconEndZeroMany },
  { name: "IconTimer", Icon: IconTimer },
  { name: "IconPause", Icon: IconPause },
  { name: "IconPlay", Icon: IconPlay },
  { name: "IconStop", Icon: IconStop },
  { name: "IconTarget", Icon: IconTarget },
  { name: "IconReview", Icon: IconReview },
  { name: "SkotMark", Icon: SkotMark },
];
