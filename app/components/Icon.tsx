export type IconName =
  | 'wallet' | 'user' | 'trending-up' | 'trending-down'
  | 'arrow-down-left' | 'arrow-up-right' | 'chevron-left'
  | 'chevron-right' | 'receipt' | 'pencil' | 'trash' | 'plus'
  | 'layers' | 'check' | 'x' | 'undo' | 'alert' | 'arrow-left'
  | 'calendar' | 'clock'

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'wallet':
      return <svg {...common}><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 9h18" /><path d="M16 14h2" /></svg>
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
    case 'trending-up':
      return <svg {...common}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
    case 'trending-down':
      return <svg {...common}><path d="m3 7 6 6 4-4 8 8" /><path d="M15 17h6v-6" /></svg>
    case 'arrow-down-left':
      return <svg {...common}><path d="M17 7 7 17" /><path d="M17 17H7V7" /></svg>
    case 'arrow-up-right':
      return <svg {...common}><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
    case 'chevron-left':
      return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>
    case 'chevron-right':
      return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>
    case 'receipt':
      return <svg {...common}><path d="M5 3 7 4.5 9 3l3 1.5L15 3l2 1.5L19 3v18l-2-1.5-2 1.5-3-1.5L9 21l-2-1.5L5 21z" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></svg>
    case 'pencil':
      return <svg {...common}><path d="m15 5 4 4" /><path d="M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z" /></svg>
    case 'trash':
      return <svg {...common}><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 14h11l1-14M9 7V4h6v3" /></svg>
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'layers':
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
    case 'x':
      return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>
    case 'undo':
      return <svg {...common}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
    case 'alert':
      return <svg {...common}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg>
    case 'arrow-left':
      return <svg {...common}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
  }
}
