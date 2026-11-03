import { useTranslation } from 'react-i18next'
import type { EditableFields } from '../app/addItems'
import type { EngineData } from '../engine/recommend'
import type { CategoryId, Material, Pattern } from '../engine/types'
import { useLabel } from './hooks'

export function FieldEditor({
  fields,
  data,
  onChange,
  guessed,
}: {
  fields: EditableFields
  data: EngineData
  onChange: (patch: Partial<EditableFields>, field: keyof EditableFields) => void
  guessed?: Set<string>
}) {
  const { t } = useTranslation()
  const label = useLabel()
  const selectClass = 'min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-sm'
  const Field = ({ id, children }: { id: keyof EditableFields; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
      <span>
        {t(`add.fields.${id === 'colourPrimary' ? 'colour' : id === 'colourSecondary' ? 'colour2' : id}`)}
        {guessed?.has(id) && <span className="ml-1 italic">({t('add.guess')})</span>}
      </span>
      {children}
    </label>
  )
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field id="subcategory">
        <select
          className={selectClass}
          value={fields.subcategory}
          onChange={(e) => {
            const sub = e.target.value
            const category = data.taxonomy.categories.find((c) => c.subcategories.some((s) => s.id === sub))?.id as CategoryId
            onChange({ subcategory: sub, category }, 'subcategory')
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
      </Field>
      <Field id="colourPrimary">
        <select className={selectClass} value={fields.colourPrimary} onChange={(e) => onChange({ colourPrimary: e.target.value }, 'colourPrimary')}>
          {data.palette.colours.map((c) => (
            <option key={c.id} value={c.id}>
              {label.colour(c.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="colourSecondary">
        <select className={selectClass} value={fields.colourSecondary ?? ''} onChange={(e) => onChange({ colourSecondary: e.target.value || null }, 'colourSecondary')}>
          <option value="">{t('add.fields.none')}</option>
          {data.palette.colours.map((c) => (
            <option key={c.id} value={c.id}>
              {label.colour(c.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="pattern">
        <select className={selectClass} value={fields.pattern} onChange={(e) => onChange({ pattern: e.target.value as Pattern }, 'pattern')}>
          {data.taxonomy.patterns.map((p) => (
            <option key={p.id} value={p.id}>
              {label.pattern(p.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="material">
        <select className={selectClass} value={fields.material} onChange={(e) => onChange({ material: e.target.value as Material }, 'material')}>
          {data.taxonomy.materials.map((m) => (
            <option key={m.id} value={m.id}>
              {label.material(m.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="warmth">
        <select className={selectClass} value={fields.warmth} onChange={(e) => onChange({ warmth: Number(e.target.value) }, 'warmth')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} · {t(`add.warmth.${n}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="formality">
        <select className={selectClass} value={fields.formality} onChange={(e) => onChange({ formality: Number(e.target.value) }, 'formality')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} · {t(`add.formality.${n}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="brand">
        <input className={selectClass} value={fields.brand} onChange={(e) => onChange({ brand: e.target.value }, 'brand')} />
      </Field>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-[var(--muted)]">
        <span>{t('add.fields.notes')}</span>
        <input className={selectClass} value={fields.notes} onChange={(e) => onChange({ notes: e.target.value }, 'notes')} />
      </label>
    </div>
  )
}
