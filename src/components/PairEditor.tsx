import { Plus, Trash2 } from 'lucide-react';
import { blankPair, type KeyValue } from '../types';

type Props = { items: KeyValue[]; onChange: (items: KeyValue[]) => void; keyPlaceholder?: string; valuePlaceholder?: string; valuesSecret?: boolean };
export function PairEditor({ items, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', valuesSecret = false }: Props) {
  function update(id: string, patch: Partial<KeyValue>) { onChange(items.map(item => item.id === id ? { ...item, ...patch } : item)); }
  return <div className="pairs">
    <div className="pair-labels"><span></span><span>KEY</span><span>VALUE</span><span></span></div>
    {items.map(row => <div className="pair-row" key={row.id}>
      <input type="checkbox" aria-label={`Enable ${row.key || 'parameter'}`} checked={row.enabled} onChange={e => update(row.id, { enabled: e.target.checked })} />
      <input className="pair-input" placeholder={keyPlaceholder} value={row.key} onChange={e => update(row.id, { key: e.target.value })} />
      <input className="pair-input" type={valuesSecret ? 'password' : 'text'} placeholder={valuePlaceholder} value={row.value} onChange={e => update(row.id, { value: e.target.value })} />
      <button className="icon-button compact subtle" title="Remove row" aria-label="Remove row" onClick={() => onChange(items.filter(x => x.id !== row.id))}><Trash2 size={14} /></button>
    </div>)}
    <button className="add-row" onClick={() => onChange([...items, blankPair()])}><Plus size={14} /> Add row</button>
  </div>;
}
