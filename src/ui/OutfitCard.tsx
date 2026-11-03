import { useTranslation } from 'react-i18next'
import type { ItemRecord } from '../data/db'
import type { OutfitProposal } from '../engine/types'
import { ItemThumb } from './components'

const ORDER = ['outer', 'layer', 'base', 'bottoms', 'belt', 'tie', 'shoes', 'accessory-1', 'accessory-2']

export function OutfitCard({
  outfit,
  itemsById,
  size = 'lg',
  locked,
  onItemTap,
  title,
}: {
  outfit: Pick<OutfitProposal, 'slots' | 'itemIds'>
  itemsById: Map<string, ItemRecord>
  size?: 'sm' | 'md' | 'lg'
  locked?: Set<string>
  onItemTap?: (slotId: string, item: ItemRecord) => void
  title?: string
}) {
  const { t } = useTranslation()
  const entries = ORDER.filter((slot) => outfit.slots[slot]).map((slot) => [slot, itemsById.get(outfit.slots[slot])] as const)
  const thumbSize = size === 'lg' ? 'lg' : size === 'md' ? 'md' : 'sm'
  return (
    <div>
      {title && <h3 className="mb-2 text-sm font-semibold text-[var(--muted)]">{title}</h3>}
      <ul className={`grid ${size === 'lg' ? 'grid-cols-3 gap-3' : 'grid-cols-4 gap-2'} justify-items-center`}>
        {entries.map(([slot, item]) =>
          item ? (
            <li key={slot} className="flex flex-col items-center gap-1">
              <ItemThumb
                item={item}
                size={thumbSize}
                onClick={onItemTap ? () => onItemTap(slot, item) : undefined}
                badge={locked?.has(item.id) ? <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-[var(--accent-fg)]">{t('today.locked')}</span> : undefined}
              />
              {size === 'lg' && <span className="text-[11px] text-[var(--muted)]">{t(`slots.${slot}`)}</span>}
            </li>
          ) : null,
        )}
      </ul>
    </div>
  )
}
