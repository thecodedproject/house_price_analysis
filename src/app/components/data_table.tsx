import { ReactNode, useMemo, useState } from 'react';
import './data_table.css';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** Value used for sorting; defaults to row[key] */
  sortValue?: (row: T) => string | number | undefined;
  align?: 'left' | 'right';
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: 1 | -1 };
  empty?: string;
}

export function DataTable<T>({ rows, columns, rowKey, initialSort, empty = 'No rows' }: Props<T>): JSX.Element {
  const [sort, setSort] = useState(initialSort ?? { key: columns[0].key, dir: 1 as 1 | -1 });

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const value = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key] as string | number | undefined);
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === vb) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [rows, columns, sort]);

  const onHeader = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  return (
    <div className="dataTableWrap">
      <table className="dataTable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'right' : undefined}>
                <button type="button" onClick={() => onHeader(c.key)}>
                  {c.header}
                  {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'right' : undefined}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
