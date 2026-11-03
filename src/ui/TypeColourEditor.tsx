import { useTranslation } from 'react-i18next'
import type { EngineData } from '../engine/recommend'
import type { CategoryId } from '../engine/types'
import { useLabel } from './hooks'

const selectClass = 'min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-sm'

/**
 * The two things a person corrects on a card: what the item is, and its
 * colour. Everything else (warmth, formality, seasons) follows from the type.
 */
export function TypeColourEditor({
  subcategory,
  colour,
  data,
  onType,
  onColour,
}: {
  subcategory: string
  colour: string
  data: EngineData
  onType: (subcategory: string, category: CategoryId) => void
  onColour: (colour: string) => void
}) {
  const { t } = useTranslation()
  const label = useLabel()
  return (
    <div className="flex flex-col gap-4 pb-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-[var(--muted)]">{t('add.type')}</span>
        <select
          className={selectClass}
          value={subcategory}
          onChange={(e) => {
            const sub = e.target.value
            const category = (data.taxonomy.categories.find((c) => c.subcategories.some((s) => s.id === sub))?.id ?? 'tops') as CategoryId
            onType(sub, category)
          }}
        >
          {data.taxonomy.categories.map((c) => (
            <optgroup key={c.id} label={label.category(c.id)}>
              {c.subcategories.map((s) => (
                <option key={s.id} value={s.id}>
                  {label.subcategory(s.id)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div>
        <p className="mb-2 text-xs text-[var(--muted)]">
          {t('add.colour')}: <span className="text-sm text-[var(--fg)]">{label.colour(colour)}</span>
        </p>
        <ul className="grid grid-cols-6 gap-2" role="listbox" aria-label={t('add.colour')}>
          {data.palette.colours.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === colour}
                aria-label={label.colour(c.id)}
                onClick={() => onColour(c.id)}
                style={{ backgroundColor: c.hex }}
                className={`h-11 w-full rounded-full border-2 ${c.id === colour ? 'border-[var(--accent)] outline outline-2 outline-offset-1 outline-[var(--accent)]' : 'border-[var(--line)]'}`}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
