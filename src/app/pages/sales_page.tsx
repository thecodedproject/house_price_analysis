import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sale } from '../../shared/types';
import { Column, DataTable } from '../components/data_table';
import { useDb } from '../data_context';
import { formatAddress, formatPrice } from '../format';

export function SalesPage(): JSX.Element {
  const { db } = useDb();
  const [status, setStatus] = useState<'' | Sale['status']>('');
  const all = useMemo(() => Object.values(db.sales), [db]);
  const rows = all.filter((s) => !status || s.status === status);

  const address = (s: Sale) => {
    const p = db.properties[s.propertyId];
    return p ? formatAddress(p) : s.propertyId;
  };

  const columns: Column<Sale>[] = [
    { key: 'date', header: 'Date' },
    {
      key: 'property',
      header: 'Property',
      sortValue: address,
      render: (s) => <Link to={`/property/${encodeURIComponent(s.propertyId)}`}>{address(s)}</Link>,
    },
    { key: 'postcode', header: 'Postcode', sortValue: (s) => db.properties[s.propertyId]?.postcode, render: (s) => db.properties[s.propertyId]?.postcode ?? '' },
    { key: 'price', header: 'Price', align: 'right', render: (s) => formatPrice(s.price) },
    { key: 'status', header: 'Status', render: (s) => <span className={`badge ${s.status}`}>{s.status}</span> },
    { key: 'source', header: 'Source' },
    { key: 'ppdCategory', header: 'PPD cat.' },
    { key: 'supersededBy', header: 'Superseded by' },
  ];

  return (
    <section>
      <div className="toolbar">
        <h2>Sales ({rows.length})</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value as '' | Sale['status'])}>
          <option value="">All statuses</option>
          <option value="final">Final</option>
          <option value="provisional">Provisional</option>
        </select>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(s) => s.id} initialSort={{ key: 'date', dir: -1 }} />
    </section>
  );
}
