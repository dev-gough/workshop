'use client';

// The flat file — the drawer of things you own (measured once) plus the
// standards library of common sizes.

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Plus, Search, ChevronDown, ChevronRight, Pencil, Trash2, Bookmark, Ruler,
} from 'lucide-react';
import {
  type CatalogueItem, type DisplayUnit, type FurniturePreset,
  CATEGORY_COLORS, FURNITURE_PRESETS, PICKER_ICONS, SWATCHES, UNIT_ABBR,
  formatDim, fromBase, toBase,
} from './model';
import { getIcon } from './icons';

export interface PlaceSpec {
  label: string; width: number; height: number; icon: string; color: string;
}

interface Props {
  unit: DisplayUnit;
  catalogue: CatalogueItem[];
  onPlace: (spec: PlaceSpec) => void;
  onAddCatalogue: (spec: PlaceSpec) => void;
  onUpdateCatalogue: (item: CatalogueItem) => void;
  onDeleteCatalogue: (id: number) => void;
}

interface FormState {
  editingId: number | null;
  label: string;
  w: string; // display units
  h: string;
  icon: string;
  color: string;
}

const EMPTY_FORM: FormState = {
  editingId: null, label: '', w: '', h: '', icon: 'Square', color: SWATCHES[7].color,
};

export default function CataloguePanel({
  unit, catalogue, onPlace, onAddCatalogue, onUpdateCatalogue, onDeleteCatalogue,
}: Props) {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const searchLower = search.toLowerCase();
  const filteredPresets = useMemo(() =>
    Object.entries(FURNITURE_PRESETS).map(([cat, presets]) => ({
      category: cat,
      items: presets.filter(p => !searchLower || p.label.toLowerCase().includes(searchLower)),
    })).filter(g => g.items.length > 0),
  [searchLower]);

  const filteredCatalogue = catalogue.filter(
    c => !searchLower || c.label.toLowerCase().includes(searchLower));

  const startAdd = () => setForm({ ...EMPTY_FORM });
  const startEdit = (item: CatalogueItem) => setForm({
    editingId: item.id,
    label: item.label,
    w: String(parseFloat(fromBase(item.width, unit).toFixed(2))),
    h: String(parseFloat(fromBase(item.height, unit).toFixed(2))),
    icon: item.icon,
    color: item.color,
  });

  const submitForm = () => {
    if (!form || !form.label.trim()) return;
    const width = Math.max(1, Math.round(toBase(parseFloat(form.w) || 24, unit)));
    const height = Math.max(1, Math.round(toBase(parseFloat(form.h) || 24, unit)));
    const spec = { label: form.label.trim(), width, height, icon: form.icon, color: form.color };
    if (form.editingId != null) onUpdateCatalogue({ id: form.editingId, ...spec });
    else onAddCatalogue(spec);
    setForm(null);
  };

  const sectionHead = 'bp-etch flex items-center gap-1.5 px-2 pt-3 pb-1.5';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Search the whole drawer */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 rounded-[3px] pl-7 text-xs"
            placeholder="Search the drawer…"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {/* ── My furniture ── */}
        <div className={sectionHead}>
          <Ruler className="h-3 w-3" style={{ color: 'var(--bp-accent)' }} />
          <span>My furniture</span>
          <span className="ml-auto font-normal normal-case tracking-normal">{catalogue.length}</span>
        </div>

        {filteredCatalogue.length === 0 && !form && (
          <p className="px-2 pb-1 text-[11px] leading-relaxed text-muted-foreground">
            {catalogue.length === 0
              ? 'Nothing measured yet. Grab a tape measure, then add each piece once — it stays here for every plan.'
              : 'No owned pieces match the search.'}
          </p>
        )}

        <div className="space-y-px px-1.5">
          {filteredCatalogue.map(item => {
            const Icon = getIcon(item.icon);
            return (
              <div key={item.id} className="group flex items-center rounded-[3px] hover:bg-muted">
                <button
                  onClick={() => onPlace(item)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
                  title="Place on the sheet"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: item.color }} />
                  <span className="truncate">{item.label}</span>
                  <span className="bp-readout ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {formatDim(item.width, unit)}×{formatDim(item.height, unit)}
                  </span>
                </button>
                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => startEdit(item)} className="p-1 text-muted-foreground hover:text-foreground" title="Re-measure">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button onClick={() => onDeleteCatalogue(item.id)} className="p-1 pr-1.5 text-muted-foreground hover:text-destructive" title="Remove from catalogue">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add / edit form */}
        {form ? (
          <div className="mx-1.5 mt-1.5 space-y-1.5 rounded-[3px] border border-border bg-muted/50 p-2">
            <Input
              autoFocus
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') submitForm(); if (e.key === 'Escape') setForm(null); }}
              className="h-6 rounded-[3px] text-xs"
              placeholder="Name (e.g. Grandma's dresser)"
            />
            <div className="flex items-center gap-1">
              <Input
                type="number" min="0" step="any" value={form.w}
                onChange={(e) => setForm({ ...form, w: e.target.value })}
                className="bp-readout h-6 flex-1 rounded-[3px] text-xs" placeholder="W"
              />
              <span className="text-[10px] text-muted-foreground">×</span>
              <Input
                type="number" min="0" step="any" value={form.h}
                onChange={(e) => setForm({ ...form, h: e.target.value })}
                className="bp-readout h-6 flex-1 rounded-[3px] text-xs" placeholder="D"
              />
              <span className="w-6 text-[10px] text-muted-foreground">{UNIT_ABBR[unit]}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {SWATCHES.map(s => (
                <button
                  key={s.color} title={s.name}
                  onClick={() => setForm({ ...form, color: s.color })}
                  className="h-4 w-4 rounded-full border"
                  style={{
                    backgroundColor: s.color,
                    borderColor: form.color === s.color ? 'var(--bp-ink)' : 'transparent',
                    outline: form.color === s.color ? '1px solid var(--bp-sheet)' : 'none',
                    outlineOffset: -3,
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-0.5">
              {PICKER_ICONS.map(key => {
                const Icon = getIcon(key);
                const on = form.icon === key;
                return (
                  <button
                    key={key}
                    onClick={() => setForm({ ...form, icon: key })}
                    className="bp-chip flex h-6 w-6 items-center justify-center"
                    data-on={on || undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 pt-0.5">
              <button onClick={submitForm} className="bp-chip flex-1 px-2 py-1 text-[11px] font-medium" data-on="true">
                {form.editingId != null ? 'Save measurements' : 'Add to catalogue'}
              </button>
              <button onClick={() => setForm(null)} className="bp-chip px-2 py-1 text-[11px]">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={startAdd}
            className="bp-chip mx-1.5 mt-1.5 flex w-[calc(100%-12px)] items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium"
          >
            <Plus className="h-3 w-3" /> Measure a piece
          </button>
        )}

        {/* ── Standards library ── */}
        <div className={`${sectionHead} mt-2 border-t border-border`}>
          <span>Standard sizes</span>
        </div>
        <p className="px-2 pb-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Common furniture, US standard dimensions. Bookmark one to copy it into your catalogue.
        </p>

        <div className="space-y-0.5 px-1.5">
          {filteredPresets.map(({ category, items: presets }) => {
            const open = expanded[category] ?? !!searchLower;
            return (
              <div key={category}>
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [category]: !open }))}
                  className="flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
                  {category}
                </button>
                {open && (
                  <div className="ml-2 space-y-px">
                    {presets.map((preset: FurniturePreset) => {
                      const Icon = getIcon(preset.icon);
                      return (
                        <div key={preset.label} className="group flex items-center rounded-[3px] hover:bg-muted">
                          <button
                            onClick={() => onPlace(preset)}
                            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs"
                            title="Place on the sheet"
                          >
                            <Icon className="h-3 w-3 shrink-0" style={{ color: preset.color }} />
                            <span className="truncate">{preset.label}</span>
                            <span className="bp-readout ml-auto shrink-0 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                              {formatDim(preset.width, unit)}×{formatDim(preset.height, unit)}
                            </span>
                          </button>
                          <button
                            onClick={() => onAddCatalogue(preset)}
                            className="shrink-0 p-1 pr-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                            title="Copy into my catalogue"
                          >
                            <Bookmark className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
